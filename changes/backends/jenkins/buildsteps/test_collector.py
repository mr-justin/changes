from __future__ import absolute_import

from flask import current_app

import logging
import uuid

from hashlib import md5

from changes.artifacts.collection_artifact import TestsJsonHandler
from changes.backends.jenkins.buildstep import JenkinsGenericBuildStep
from changes.backends.jenkins.generic_builder import JenkinsGenericBuilder
from changes.artifacts.manager import Manager
from changes.artifacts.manifest_json import ManifestJsonHandler
from changes.buildsteps.base import BuildStep
from changes.config import db
from changes.constants import Result, Status
from changes.db.utils import get_or_create, try_create
from changes.expanders.tests import TestsExpander
from changes.jobs.sync_job_step import sync_job_step
from changes.models.failurereason import FailureReason
from changes.models.jobphase import JobPhase
from changes.models.jobstep import JobStep
from changes.models.test import TestCase
from changes.utils.agg import aggregate_result


class JenkinsTestCollectorBuilder(JenkinsGenericBuilder):
    def __init__(self, shard_build_type=None, shard_setup_script=None, shard_teardown_script=None,
                 *args, **kwargs):
        self.shard_build_desc = self.load_build_desc(shard_build_type)
        self.shard_setup_script = shard_setup_script
        self.shard_teardown_script = shard_teardown_script
        super(JenkinsTestCollectorBuilder, self).__init__(*args, **kwargs)

    def can_snapshot(self):
        """
        For the case of a sharded build, whether we can snapshot or not
        is determined solely by whether the shards use lxc - the collection
        phase is irrelevant.
        """
        return self.shard_build_desc.get('can_snapshot', False)

    def get_snapshot_build_desc(self):
        """
        We use the shard-phase build description in order to build the snapshot
        since it is common that the collection phase description doesn't even
        support snapshots, and we need the distribution/release to match otherwise
        it won't be able to find the snapshot.
        """
        return self.shard_build_desc

    def get_snapshot_setup_script(self):
        """
        Generally the collection phase doesn't need to do any setup, and we wish
        to optimize the shard phase which is where the work lies, so we run the setup
        phase of the shard (generally the provisioning of an individual shard).
        """
        return self.shard_setup_script

    def get_snapshot_teardown_script(self):
        """
        Teardown is less useful for snapshot builds, but in the case that it actually
        does something useful like remove logs (of, for example, services that started
        during the snapshot build but then get killed because we destroy the container),
        this could keep the actual snapshot cleaner as the teardown is run before the
        snapshot itself is taken.
        """
        return self.shard_teardown_script

    def get_default_job_phase_label(self, job, job_data):
        return 'Collect Tests'

    def get_required_handler(self):
        """The initial (collect) step must return at least one artifact
        that this handler can process, or it will be marked as failed.

        Returns:
            class: the handler class for the required artifact
        """
        return TestsJsonHandler

    def artifacts_for_jobstep(self, jobstep):
        # we only care about the required artifact for the collection phase
        return self.artifacts if jobstep.data.get('expanded') else (self.get_required_handler().FILENAMES[0],)

    def get_artifact_manager(self, jobstep):
        if jobstep.data.get('expanded'):
            return super(JenkinsTestCollectorBuilder, self).get_artifact_manager(jobstep)
        else:
            return Manager([self.get_required_handler(), ManifestJsonHandler])

    def verify_final_artifacts(self, step, artifacts):
        super(JenkinsTestCollectorBuilder, self).verify_final_artifacts(step, artifacts)

        # We annotate the "expanded" jobs with this tag, so the individual
        # shards will no longer require the critical artifact
        if step.data.get('expanded'):
            return

        expected_image = self.get_expected_image(step.job_id)

        # if this is a snapshot build then we don't have to worry about
        # sanity checking the normal artifacts
        if expected_image:
            return

        required_handler = self.get_required_handler()

        if not any(required_handler.can_process(a.name) for a in artifacts):
            step.result = Result.failed
            db.session.add(step)

            job = step.job
            try_create(FailureReason, {
                'step_id': step.id,
                'job_id': job.id,
                'build_id': job.build_id,
                'project_id': job.project_id,
                'reason': 'missing_artifact'
            })
            db.session.commit()


class JenkinsTestCollectorBuildStep(JenkinsGenericBuildStep):
    """
    Fires off a generic job with parameters:

        CHANGES_BID = UUID
        CHANGES_PID = project slug
        REPO_URL    = repository URL
        REPO_VCS    = hg/git
        REVISION    = sha/id of revision
        PATCH_URL   = patch to apply, if available
        SCRIPT      = command to run

    A "tests.json" is expected to be collected as an artifact with the following
    values:

        {
            "phase": "optional phase name",
            "cmd": "py.test --junit=junit.xml {test_names}",
            "path": "",
            "tests": [
                "foo.bar.test_baz",
                "foo.bar.test_bar"
            ]
        }

    The collected tests will be sorted and partitioned evenly across a set number
    of shards with the <cmd> value being passed a space-delimited list of tests.
    """
    builder_cls = JenkinsTestCollectorBuilder

    # TODO(dcramer): longer term we'd rather have this create a new phase which
    # actually executes a different BuildStep (e.g. of order + 1), but at the
    # time of writing the system only supports a single build step.
    def __init__(self, shards=None, max_shards=10, collection_build_type=None,
                 build_type=None, setup_script='', teardown_script='',
                 collection_setup_script='', collection_teardown_script='',
                 test_stats_from=None,
                 **kwargs):
        """
        Arguments:
            shards = number of shards to use
            max_shards = legacy option, same as shards
            collection_build_type = build type to use for the collection phase
            collection_setup_script = setup to use for the collection phase
            collection_teardown_script = teardown to use for the collection phase
            build_type = build type to use for the shard phase
            setup_script = setup to use for the shard phase
            teardown_script = teardown to use for the shard phase

            test_stats_from = project to get test statistics from, or
              None (the default) to use this project.  Useful if the
              project runs a different subset of tests each time, so
              test timing stats from the parent are not reliable.

        """
        # TODO(josiah): migrate existing step configs to use "shards" and remove max_shards
        if shards:
            self.max_shards = shards
        else:
            self.max_shards = max_shards

        # its fairly normal that the collection script is simple and so LXC is a waste
        # of time, so we support running the shards and the collector in different
        # environments
        self.shard_build_type = build_type

        if self.shard_build_type is None:
            self.shard_build_type = current_app.config[
                'CHANGES_CLIENT_DEFAULT_BUILD_TYPE']

        super(JenkinsTestCollectorBuildStep, self).__init__(
            build_type=collection_build_type,
            setup_script=collection_setup_script,
            teardown_script=collection_teardown_script,
            **kwargs)

        self.shard_setup_script = setup_script
        self.shard_teardown_script = teardown_script
        self.test_stats_from = test_stats_from

    def get_builder_options(self):
        options = super(JenkinsTestCollectorBuildStep, self).get_builder_options()
        options.update({
            'shard_build_type': self.shard_build_type,
            'shard_setup_script': self.shard_setup_script,
            'shard_teardown_script': self.shard_teardown_script
        })
        return options

    def get_label(self):
        return 'Collect tests from job "{0}" on Jenkins'.format(self.job_name)

    def get_test_stats_from(self):
        return self.test_stats_from

    def _validate_shards(self, phase_steps):
        """This returns passed/unknown based on whether the correct number of
        shards were run."""
        step_expanded_flags = [step.data.get('expanded', False) for step in phase_steps]
        assert all(step_expanded_flags) or not any(step_expanded_flags), \
            "Mixed expanded and non-expanded steps in phase!"
        expanded = step_expanded_flags[0]
        if not expanded:
            # This was the initial phase, not the expanded phase. No need to
            # check shards.
            return Result.passed

        step_shard_counts = [step.data.get('shard_count', 1) for step in phase_steps]
        assert len(set(step_shard_counts)) == 1, "Mixed shard counts in phase!"
        shard_count = step_shard_counts[0]
        if len(phase_steps) != shard_count:
            # TODO(josiah): we'd like to be able to record a FailureReason
            # here, but currently a FailureReason must correspond to a JobStep.
            logging.error("Build failed due to incorrect number of shards: expected %d, got %d",
                          shard_count, len(phase_steps))
            return Result.unknown
        return Result.passed

    def validate_phase(self, phase):
        """Called when a job phase is ready to be finished.

        This is responsible for setting the phases's final result. We verify
        that the proper number of steps were created in the second (i.e.
        expanded) phase."""
        phase.result = aggregate_result([s.result for s in phase.current_steps] +
                                        [self._validate_shards(phase.current_steps)])

    def _normalize_test_segments(self, test_name):
        sep = TestCase(name=test_name).sep
        segments = test_name.split(sep)

        # kill the file extension
        if sep is '/' and '.' in segments[-1]:
            segments[-1] = segments[-1].rsplit('.', 1)[0]

        return tuple(segments)

    def expand_jobs(self, step, phase_config):
        """
        Creates and runs JobSteps for a set of tests, based on a phase config.

        This phase config comes from a tests.json file that the collection
        jobstep should generate. This method is then called by the TestsJsonHandler.
        """
        assert phase_config['cmd']
        assert '{test_names}' in phase_config['cmd']
        assert 'tests' in phase_config

        num_tests = len(phase_config['tests'])
        test_stats, avg_test_time = TestsExpander.get_test_stats(self.get_test_stats_from() or step.project.slug)

        phase, _ = get_or_create(JobPhase, where={
            'job': step.job,
            'project': step.project,
            'label': phase_config.get('phase') or 'Test',
        }, defaults={
            'status': Status.queued
        })
        db.session.commit()

        # If there are no tests to run, the phase is done.
        if num_tests == 0:
            phase.status = Status.finished
            phase.result = Result.passed
            db.session.add(phase)
            db.session.commit()
            return

        # Check for whether a previous run of this task has already
        # created JobSteps for us, since doing it again would create a
        # double-sharded build.
        steps = JobStep.query.filter_by(phase_id=phase.id, replacement_id=None).all()
        if steps:
            step_shard_counts = [s.data.get('shard_count', 1) for s in steps]
            assert len(set(step_shard_counts)) == 1, "Mixed shard counts in phase!"
            assert len(steps) == step_shard_counts[0]
        else:
            # Create all of the job steps and commit them together.
            groups = TestsExpander.shard_tests(phase_config['tests'], self.max_shards,
                                       test_stats, avg_test_time)
            steps = [
                self._create_jobstep(phase, phase_config['cmd'], phase_config.get('path', ''),
                                     weight, test_list, len(groups))
                for weight, test_list in groups
                ]
            assert len(steps) == len(groups)
            db.session.commit()

        # Now that that database transaction is done, we'll do the slow work of
        # creating jenkins builds.
        for step in steps:
            self._create_jenkins_build(step)
            sync_job_step.delay_if_needed(
                step_id=step.id.hex,
                task_id=step.id.hex,
                parent_task_id=phase.job.id.hex,
            )

    def _create_jobstep(self, phase, phase_cmd, phase_path, weight, test_list, shard_count=1, force_create=False):
        """
        Create a JobStep in the database for a single shard.

        This creates the JobStep, but does not commit the transaction.

        Args:
            phase (JobPhase): The phase this step will be part of.
            phase_cmd (str): Command configured for the collection step.
            phase_path (str): Path configured for the collection step.
            weight (int): The weight of this shard.
            test_list (list): The list of tests names for this shard.
            shard_count (int): The total number of shards in this JobStep's phase.
            force_create (bool): Force this JobStep to be created (rather than
                retrieved). This is used when replacing a JobStep to make sure
                we don't just get the old one.

        Returns:
            JobStep: the (possibly-newly-created) JobStep.
        """
        test_names = ' '.join(test_list)
        label = md5(test_names).hexdigest()

        where = {
            'job': phase.job,
            'project': phase.project,
            'phase': phase,
            'label': label,
        }
        if force_create:
            # uuid is unique so forces JobStep to be created
            where['id'] = uuid.uuid4()

        step, created = get_or_create(JobStep, where=where, defaults={
            'data': {
                'cmd': phase_cmd,
                'path': phase_path,
                'tests': test_list,
                'expanded': True,
                'shard_count': shard_count,
                'job_name': self.job_name,
                'build_no': None,
                'weight': weight,
            },
            'status': Status.queued,
        })
        assert created or not force_create
        BuildStep.handle_debug_infra_failures(step, self.debug_config, 'expanded')
        db.session.add(step)
        return step

    def create_replacement_jobstep(self, step):
        if not step.data.get('expanded'):
            return super(JenkinsTestCollectorBuildStep, self).create_replacement_jobstep(step)
        newstep = self._create_jobstep(step.phase, step.data['cmd'], step.data['path'],
                                       step.data['weight'], step.data['tests'],
                                       step.data['shard_count'], force_create=True)
        step.replacement_id = newstep.id
        db.session.add(step)
        db.session.commit()

        self._create_jenkins_build(newstep)
        sync_job_step.delay_if_needed(
            step_id=newstep.id.hex,
            task_id=newstep.id.hex,
            parent_task_id=newstep.phase.job.id.hex,
        )
        return newstep

    def _create_jenkins_build(self, step):
        """
        Create a jenkins build for the given expanded jobstep.

        If the given step already has a jenkins build associated with it, this
        will not perform any work. If not, this creates the build, updates the
        step to refer to the new build, and commits the change to the database.

        Args:
            step (JobStep): The shard we'd like to launch a jenkins build for.
        """
        # we also have to inject the correct build_type here in order
        # to generate the correct params and to generate the correct
        # commands later on
        builder = self.get_builder(build_type=self.shard_build_type)

        builder.create_jenkins_build(step, job_name=step.data['job_name'],
            script=step.data['cmd'].format(
                test_names=' '.join(step.data['tests']),
            ),
            setup_script=self.shard_setup_script,
            teardown_script=self.shard_teardown_script,
            path=step.data['path'],
        )
