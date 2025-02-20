from __future__ import absolute_import, print_function

from cStringIO import StringIO

import mock

from changes.artifacts.base import ArtifactHandler
from changes.artifacts.manager import Manager
from changes.testutils import TestCase


class ManagerTest(TestCase):
    @mock.patch.object(ArtifactHandler, 'process')
    def test_process_behavior(self, process):
        handler = ArtifactHandler
        handler.FILENAMES = ('coverage.xml',)

        manager = Manager()
        manager.register(handler)

        project = self.create_project()
        build = self.create_build(project)
        job = self.create_job(build)
        jobphase = self.create_jobphase(job)
        jobstep = self.create_jobstep(jobphase)

        artifact = self.create_artifact(
            step=jobstep,
            name='junit.xml',
        )
        artifact.file.save(StringIO(), artifact.name)
        manager.process(artifact)

        assert not process.called

        artifact = self.create_artifact(
            step=jobstep,
            name='coverage.xml',
        )
        artifact.file.save(StringIO(), artifact.name)
        manager.process(artifact)

        artifact = self.create_artifact(
            step=jobstep,
            name='foo/coverage.xml',
        )
        artifact.file.save(StringIO(), artifact.name)
        manager.process(artifact)

        assert process.call_count == 2
