import React, { PropTypes } from 'react';
import { OverlayTrigger, Tooltip } from 'react_bootstrap';

import { ChangesPage, APINotLoadedPage } from 'es6!display/page_chrome';
import { ProgrammingError } from 'es6!display/errors';
import { Tabs, MenuUtils } from 'es6!display/menus';

import BuildsTab from 'es6!pages/project_page/builds_tab';
import CommitsTab from 'es6!pages/project_page/commits_tab';
import DetailsTab from 'es6!pages/project_page/details_tab';
import InteractiveData from 'es6!pages/helpers/interactive_data';
import TestsTab from 'es6!pages/project_page/tests_tab';
import TriageTab from 'es6!pages/project_page/triage_tab';

import * as api from 'es6!server/api';

import * as utils from 'es6!utils/utils';

var ProjectPage = React.createClass({

  getInitialState: function() {
    return {
      selectedItem: null, // we set this in componentWillMount
      project: null,
      commits: null,
      flakyTests: null,
      quarantineTasks: null,
      details: null,

      // Keep the state for the commit tab here (and send it via props.) This
      // preserves the state if the user clicks to another tab
      commitsState: {},

      // same, but for builds state
      buildsInteractive: {}
    }
  },

  menuItems: [
    'Commits',
    'Builds',
    'Tests',
    'Details',
    'Triage',
  ],

  componentWillMount: function() {
    // if our url contains a hash, show that tab
    var selected_item_from_hash = MenuUtils.selectItemFromHash(
      window.location.hash, this.menuItems);

    // when we first came to this page, which tab was shown? Used by the
    // initial data fetching within tabs
    this.initialTab = selected_item_from_hash || 'Commits';

    this.setState({ selectedItem: this.initialTab });

    // initialize our paging objects. Data fetching still doesn't happen
    // till componentDidMount (either ours or the subcomponent.)
    this.setState({
      buildsInteractive: InteractiveData(
        this,
        'buildsInteractive',
        BuildsTab.getEndpoint(this.props.projectSlug)),

      commitsInteractive: InteractiveData(
        this,
        'commitsInteractive',
        CommitsTab.getEndpoint(this.props.projectSlug))
    });
  },

  componentDidMount: function() {
    var slug = this.props.projectSlug;

    // grab the initial project data needed to render anything. We also eagerly
    // grab some data for our tabs so that they load faster
    api.fetch(this, {
      project: `/api/0/projects/${slug}`,
    });
  },

  render: function() {
    if (!api.isLoaded(this.state.project)) {
      return <APINotLoadedPage calls={this.state.project} />;
    }

    utils.setPageTitle(
      this.state.project.getReturnedData().name + ' - ' +
      this.state.selectedItem
    );

    // render menu
    var selected_item = this.state.selectedItem;
    var onClick = item => {
      if (item === selected_item) {
        return;
      }

      window.history.replaceState(
        null,
        'changed tab',
        URI(window.location.href)
          .search("")
          .hash(item.replace(/ /g, ""))
          .toString()
      );
      this.setState({selectedItem: item});
    }
    var menu = <Tabs
      items={this.menuItems}
      selectedItem={selected_item}
      onClick={onClick}
    />;

    var content = null;
    switch (selected_item) {
      case 'Commits':
        content = <CommitsTab
          project={this.state.project}
          interactive={this.state.commitsInteractive}
          isInitialTab={this.initialTab === 'Commits'}
          pageElem={this}
        />;
        break;
      case 'Builds':
        content = <BuildsTab
          project={this.state.project}
          interactive={this.state.buildsInteractive}
          isInitialTab={this.initialTab === 'Builds'}
          pageElem={this}
        />;
        break;
      case 'Tests':
        content = <TestsTab
          project={this.state.project}
          flakyTests={this.state.flakyTests}
          quarantineTasks={this.state.quarantineTasks}
          pageElem={this}
        />;
        break;
      case 'Details':
        content = <DetailsTab
          project={this.state.project}
          details={this.state.details}
          pageElem={this}
        />;
        break;
      case 'Triage':
        content = <TriageTab
          project={this.state.project}
        />;
        break;
      default:
        content = <ProgrammingError>
          Unknown tab {selected_item}
        </ProgrammingError>;
    }

    var padding_classes = 'paddingLeftL paddingRightL';
    return <ChangesPage bodyPadding={false}>
      {this.renderProjectInfo(this.state.project.getReturnedData())}
      <div className={padding_classes}>
        {menu}
        {content}
      </div>
    </ChangesPage>;
  },

  renderProjectInfo: function(project_info) {
    var triggers = _.compact([
      project_info.options["phabricator.diff-trigger"] ? "Diffs" : null,
      project_info.options["build.commit-trigger"] ? "Commits" : null,
    ]);

    var branches_option = project_info.options["build.branch-names"] || '*';
    if (branches_option === "*") {
      var branches = "all branches";
    } else if (branches_option.split(" ").length === 1) {
      var branches = `only on ${branches_option} branch`;
    } else {
      var branches = "branches: " + branches_option.replace(/ /g, ", ");
    }

    var whitelist_msg = "";
    var whitelist_option = project_info.options["build.file-whitelist"];
    if (whitelist_option) {
      var whitelist_paths = utils.split_lines(whitelist_option);
      var whitelist_tooltip = <Tooltip>
        {_.map(whitelist_paths, p => <div>{p}</div>)}
      </Tooltip>;

      whitelist_msg = <span style={{fontWeight: 600}}>
        Builds are only run for changes that touch
        {" "}
        <OverlayTrigger placement="bottom" overlay={whitelist_tooltip}>
          <span style={{borderBottom: "1px dotted #777"}}>
            certain paths
          </span>
        </OverlayTrigger>
        {"."}
      </span>
    }

    return <div style={{ padding: 20 }}>
      <div><b>{project_info.name}</b>
        <tt> (arc test {project_info.slug})</tt> 
      </div>
      <span style={{ fontWeight: 600 }}>Repository:</span>
        {" "}{project_info.repository.url}{" "}
        {" ("}
        {branches}
        {")"}
      <div>{whitelist_msg}</div>
    </div>;
  }
});

export default ProjectPage;
