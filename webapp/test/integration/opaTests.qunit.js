/* global QUnit */
QUnit.config.autostart = false;

sap.ui.require(["salesorder/test/integration/AllJourneys"
], function () {
	QUnit.start();
});
