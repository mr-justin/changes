import React from 'react';
import { Popover, OverlayTrigger, Tooltip } from 'react_bootstrap';

import APINotLoaded from 'es6!display/not_loaded';
import DisplayUtils from 'es6!display/changes/utils';
import { AjaxError } from 'es6!display/errors';
import { BuildWidget, status_dots } from 'es6!display/changes/builds';
import { Grid } from 'es6!display/grid';
import { TimeText } from 'es6!display/time';

import DataControls from 'es6!pages/helpers/data_controls';

import * as api from 'es6!server/api';

import * as utils from 'es6!utils/utils';

var CommitsTab = React.createClass({

  propTypes: {
    // the project api response. Always loaded
    project: React.PropTypes.object,

    // controls
    controls: React.PropTypes.object,

    // parent elem that has state
    pageElem: React.PropTypes.element.isRequired,
  },

  getInitialState: function() {
    // powers on-hover list of failed tests. Its ok for this to get wiped out
    // every time we switch tabs
    return { failedTests: [] };
  },

  statics: {
    getEndpoint: function(project_slug) {
      return URI(`/api/0/projects/${project_slug}/commits/`)
        .query({ 'all_builds': 1 })
        .toString();
    },

    doDataFetching: function(controls, is_selected_tab) {
      // if the user is loading this tab on a new full page load, use the page url
      // query params as the api parameters (allows link sharing)
      var params = is_selected_tab ? DataControls.getParamsFromWindowUrl() : null;
      params = params || {};

      controls.initialize(params);
    },
  },

  componentDidMount: function() {
    // if we're revisiting this tab, let's restore the window url to the
    // current state
    if (api.isLoaded(this.props.controls.getDataToShow())) {
      this.props.controls.updateWindowUrl();
    }

    // TODO: maybe store this in parent state
    var repo_id = this.props.project.getReturnedData().repository.id;
    api.fetch(
      this,
      { 'branches': `/api/0/repositories/${repo_id}/branches` }
    );
  },

  render: function() {
    var controls = this.props.controls;

    if (controls.hasNotLoadedInitialData()) {
      return <APINotLoaded
        state={controls.getDataToShow()}
        isInline={true}
      />;
    }

    // we might be in the middle of / failed to load updated data
    var error_message = null;
    if (controls.failedToLoadUpdatedData()) {
      error_message = <AjaxError response={controls.getDataForErrorMessage().response} />;
    }

    var style = controls.isLoadingUpdatedData() ? {opacity: 0.5} : null;

    return <div style={style}>
      {this.renderTableControls()}
      {error_message}
      {this.renderTable()}
      {this.renderPagination()}
    </div>;
  },

  renderTableControls: function() {
    var default_branch = this.props.project.getReturnedData()
      .repository.defaultBranch;
    var current_params = this.props.controls.getCurrentParams();
    var current_branch = current_params.branch || default_branch;

    var branch_dropdown = null;
    if (api.isError(this.state.branches) &&
        this.state.branches.getStatusCode() === '422') {

      branch_dropdown = <select disabled={true}>
        <option>No branches</option>
      </select>;
    } else if (!api.isLoaded(this.state.branches)) {
      branch_dropdown = <select disabled={true}>
        <option value={current_branch}>{current_branch}</option>
      </select>;
    } else {
      var options = _.chain(this.state.branches.getReturnedData())
        .pluck('name')
        .sortBy(_.identity)
        .map(n => <option value={n}>{n}</option>)
        .value();

      var onChange = evt => {
        this.props.controls.updateWithParams(
          { branch: evt.target.value },
          true); // reset to page 0
      };

      branch_dropdown = <select onChange={onChange} value={current_branch}>
        {options}
      </select>;
    }

    /*
    <span className="paddingLeftS">
      Showing most recent diffs since 0:00pm
    </span>
    */
    return <div style={{marginBottom: 5, marginTop: 10}}>
      <input
        disabled={true}
        placeholder="Search by name or SHA [TODO]"
        style={{minWidth: 170, marginRight: 5}}
      />
      {branch_dropdown}
      <label style={{float: 'right', paddingTop: 3}}>
        <span style={/* disabled color */ {color: '#aaa', fontSize: 'small'}}>
          Live update
          <input
            type="checkbox"
            checked={false}
            className="noRightMargin"
            disabled={true}
          />
        </span>
      </label>
    </div>;
  },

  renderTable: function() {
    var data_to_show = this.props.controls.getDataToShow().getReturnedData(),
      project_info = this.props.project.getReturnedData();

    var grid_data = _.map(data_to_show, c => this.turnIntoRow(c, project_info));

    var cellClasses = ['nowrap buildWidgetCell', 'nowrap', 'nowrap', 'wide', 'nowrap', 'nowrap'];
    var headers = ['Last Build', 'Author', 'Commit', 'Name', 'Prev. B.', 'Committed'];

    return <Grid
      colnum={6}
      data={grid_data}
      cellClasses={cellClasses}
      headers={headers}
    />;
  },

  turnIntoRow: function(c, project_info) {
    var sha_item = c.sha.substr(0,7);
    if (c.external && c.external.link) {
      sha_item = <a classname="external" href={c.external.link} target="_blank">
        {sha_item}
      </a>;
    }

    var title = utils.first_line(c.message);
    if (c.message.indexOf("#skipthequeue") !== -1) {
      // dropbox-specific logic.
      var tooltip = <Tooltip>
        This commit bypassed the commit queue
      </Tooltip>;

      title = <span>
        {title}
        <OverlayTrigger placement="bottom" overlay={tooltip}>
          <i className="fa fa-fast-forward lt-magenta marginLeftS" />
        </OverlayTrigger>
      </span>;
    }

    var build_widget = null, prev_builds = null;
    if (c.builds && c.builds.length > 0) {
      var last_build = _.first(c.builds);
      build_widget = <BuildWidget build={last_build} />;
      if (c.builds.length > 1) {
        prev_builds = <span style={{opacity: "0.5"}}>
          {status_dots(c.builds.slice(1))}
        </span>;
      }

      if (last_build.stats['test_failures'] > 0) {
        build_widget = this.showFailuresOnHover(last_build, build_widget);
      }
    }

    var commit_page = null;
    if (c.builds && c.builds.length > 0) {
      var commit_page = '/v2/project_commit/' +
        project_info.slug + '/' +
        c.builds[0].source.id;
    }

    // TODO: if there are any comments, show a comment icon on the right
    return [
      build_widget,
      DisplayUtils.authorLink(c.author),
      sha_item,
      title,
      prev_builds,
      <TimeText time={c.dateCommitted} />
    ];
  },

  showFailuresOnHover: function(build, build_widget) {
    var popover = null;
    if (api.isLoaded(this.state.failedTests[build.id])) {
      var data = this.state.failedTests[build.id].getReturnedData();
      var list = _.map(data.testFailures.tests, t => {
        return <div>{_.last(t.name.split("."))}</div>;
      });
      if (data.testFailures.tests.length < build.stats['test_failures']) {
        list.push(
          <div className="marginTopS"> <em>
            Showing{" "}
            {data.testFailures.tests.length}
            {" "}out of{" "}
            {build.stats['test_failures']}
            {" "}test failures
          </em> </div>
        );
      }

      var popover = <Popover className="popoverNoMaxWidth">
        <span className="bb">Failed Tests:</span>
        {list}
      </Popover>;
    } else {
      // we want to fetch more build information and show a list of failed
      // tests on hover. To do this, we'll create an anonymous react element
      // that does data fetching on mount
      var data_fetcher_defn = React.createClass({
        componentDidMount() {
          var elem = this.props.elem,
            build_id = this.props.buildID;
          if (!elem.state.failedTests[build_id]) {
            api.fetchMap(elem, 'failedTests', {
              [ build_id ]: `/api/0/builds/${build_id}/`
            });
          }
        },

        render() {
          return <span />;
        }
      });

      var data_fetcher = React.createElement(
        data_fetcher_defn,
        {elem: this, buildID: build.id}
      );

      var popover = <Popover>
        {data_fetcher}
        Loading failed test list
      </Popover>;
    }

    return <div>
      <OverlayTrigger
        trigger='hover'
        placement='right'
        overlay={popover}>
        <div>{build_widget}</div>
      </OverlayTrigger>
    </div>;
  },

  renderPagination: function() {
    var links = this.props.controls.getPaginationLinks();
    return <div>{links}</div>;
  },
});

export default CommitsTab;
