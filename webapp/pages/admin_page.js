import React, { PropTypes } from 'react';

import APINotLoaded from 'es6!display/not_loaded';
import SectionHeader from 'es6!display/section_header';
import { AjaxError } from 'es6!display/errors';
import { ChangesPage, APINotLoadedPage } from 'es6!display/page_chrome';
import ChangesLinks from 'es6!display/changes/links';
import * as FieldGroupMarkup from 'es6!display/field_group';
import { Grid, GridRow } from 'es6!display/grid';
import { Tabs, MenuUtils } from 'es6!display/menus';
import { TestDetails } from 'es6!display/changes/test_details';
import { TimeText } from 'es6!display/time';

import InteractiveData from 'es6!pages/helpers/interactive_data';

import * as api from 'es6!server/api';

import * as utils from 'es6!utils/utils';

let AdminPage = React.createClass({

  mixins: [React.addons.LinkedStateMixin],

  menuItems: [
    'Projects',
    'New Project',
    'Repositories',
    'Users',
  ],

  getInitialState: function() {
    return {
      selectedItem: null, // set in componentWillMount
    }
  },

  componentWillMount: function() {
    let selectedItemFromHash = MenuUtils.selectItemFromHash(
      window.location.hash, this.menuItems);

    // when we first came to this page, which tab was shown? Used by the
    // initial data fetching within tabs
    this.initialTab = selectedItemFromHash || 'Projects';

    this.setState({
      selectedItem: this.initialTab,
      repositoriesInteractive: InteractiveData(
        this,
        'repositoriesInteractive',
        '/api/0/repositories/?status='),
      usersInteractive: InteractiveData(
        this,
        'usersInteractive',
        '/api/0/users/')
    });
  },

  componentDidMount: function() {
    api.fetch(this, {
      projects: '/api/0/projects/',
    });

    var interactives = [this.state.repositoriesInteractive, this.state.usersInteractive];

    _.each(interactives, interactive => {
      if (!interactive.hasRunInitialize()) {
        interactive.initialize({});
      }
    });
  },

  render: function() {
    if (!api.isLoaded(this.state.projects)) {
      return <APINotLoadedPage calls={this.state.projects} />;
    }
    let projects = this.state.projects.getReturnedData();

    let title = 'Admin Panel'
    utils.setPageTitle(title);

    // render menu
    let selectedItem = this.state.selectedItem;

    let menu = <Tabs
      items={this.menuItems}
      selectedItem={selectedItem}
      onClick={MenuUtils.onClick(this, selectedItem)}
    />;

    let content = null;
    switch (selectedItem) {
      case 'Projects':
        content = this.renderProjects();
        break;
      case 'New Project':
        content = this.renderNewProject();
        break;
      case 'Repositories':
        content = this.renderRepositories();
        break;
      case 'Users':
        content = this.renderUsers();
        break;
      default:
        throw 'unreachable';
    }

    return <ChangesPage highlight="Projects">
      <SectionHeader>{title}</SectionHeader>
      {menu}
      <div className="marginTopS">{content}</div>
    </ChangesPage>;
  },

  renderProjects: function() {
    if (!api.isLoaded(this.state.projects)) {
      return <APINotLoadedPage calls={this.state.projects} />;
    }
    let projects = this.state.projects.getReturnedData();

    let rows = [];
    _.each(projects, project => {
      rows.push([
        ChangesLinks.projectAdmin(project),
        project.status.name,
        <TimeText time={project.dateCreated} />
      ]);
    });

    return <div>
      <Grid
        colnum={3}
        className="marginBottomM marginTopM"
        data={rows}
        headers={['Name', 'Status', 'Creation Date']}
      />
    </div>;
  },

  renderNewProject: function() {
    let form = [
      { sectionTitle: 'New Project', fields: [
        {type: 'text', display: 'Name', link: 'name'},
        {type: 'text', display: 'Repository', link: 'repository'},
        ]
      }
    ];

    let fieldMarkup = FieldGroupMarkup.create(form, "Save Project", this);
    return <div>{fieldMarkup}</div>;
  },

  saveSettings: function() {
    let state = this.state;
    let project_params = {
      'name': state.name,
      'repository': state.repository,
    };

    let endpoints = {
      '_postRequest_newproject': `/api/0/projects/`,
    };
    let params = {
      '_postRequest_newproject': project_params,
    };

    api.post(this, endpoints, params);
  },

  renderRepositories: function() {
    var interactive = this.state.repositoriesInteractive;
    if (interactive.hasNotLoadedInitialData()) {
      return <APINotLoaded calls={interactive.getDataToShow()} />;
    }

    let repositories = interactive.getDataToShow().getReturnedData();
    let rows = [];
    _.each(repositories, repository => {
      rows.push([
        repository.url,
        repository.status.name,
        repository.backend.name,
        <TimeText time={repository.dateCreated} />
      ]);
    });

    var pagingLinks = interactive.getPagingLinks({
      use_next_previous: true,
    });
    return <div>
      <Grid
        colnum={4}
        className="marginBottomM marginTopM"
        data={rows}
        headers={['Name', 'Status', 'Backend', 'Created']}
      />
      <div className="marginTopM marginBottomM">{pagingLinks}</div>
    </div>;
  },

  renderUsers: function() {
    var interactive = this.state.usersInteractive;
    if (interactive.hasNotLoadedInitialData()) {
      return <APINotLoaded calls={interactive.getDataToShow()} />;
    }

    let users = interactive.getDataToShow().getReturnedData();
    let rows = [];
    _.each(users, user => {
      rows.push([
        user.email,
        user.isAdmin ? 'true' : 'false',
        <TimeText time={user.dateCreated} />
      ]);
    });

    var pagingLinks = interactive.getPagingLinks({
      use_next_previous: true,
    });
    return <div>
      <Grid
        colnum={3}
        className="marginBottomM marginTopM"
        data={rows}
        headers={['Email', 'Admin?', 'Created']}
      />
      <div className="marginTopM marginBottomM">{pagingLinks}</div>
    </div>;
  },
});

export default AdminPage;
