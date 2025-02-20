import React, { PropTypes } from 'react';

import Examples from 'es6!display/examples';

export var Button = React.createClass({

  propTypes: {
    // blue for primary actions, white for secondary, paging just for paging
    // links, chart-paging for the chart on the builds page
    type: PropTypes.oneOf(['blue', 'white', 'paging', 'chart_paging']),
    // paging buttons can be disabled. Haven't written the css for disabling
    // other buttons yet, though
    disabled: PropTypes.bool
    // ...
    // transfers other properties to rendered <a />
  },

  getDefaultProps: function() {
    return {
      type: 'blue',
      disabled: false
    }
  },

  render: function() {
    var { label, className, ...props } = this.props;

    var buttonClass = {
      blue: 'blueButton button ',
      white: 'whiteButton button ',
      paging: 'pagingButton button ',
      chart_paging: 'chartPagingButton ',
    }[this.props.type];

    var className = buttonClass + (className || "");
    if (this.props.disabled) {
      className += " disabled";
      props.href = null;
      props.onClick = null;
    }

    return <a className={className} {...props}>{this.props.children}</a>;
  }
});

Examples.add('Buttons', __ => {
  return [
    <div>
      <Button className="marginRightS" type="blue">Main Button</Button>
      <Button disabled={true} className="marginRightS" type="blue">Disabled Button</Button>
    </div>,
    <div>
      <Button className="marginRightS" type="white">Secondary Button</Button>
      <Button disabled={true} type="white">Secondary Button</Button>
    </div>,
    <div>
      <Button className="marginRightS" type="paging">&laquo; Previous</Button>
      <Button disabled={true} type="paging">Next &raquo;</Button>
    </div>
  ];
});
