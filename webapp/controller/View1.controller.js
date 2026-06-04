sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/core/Fragment"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, SelectDialog, StandardListItem, Fragment) {
    "use strict";

    return Controller.extend("salesorder.controller.View1", {

        onInit() {
            const oView = this.getView();
            // Ensure a named 'ui' JSON model exists for view-state and transient UI data
            if (!oView.getModel("ui")) {
                const oUIModel = new JSONModel({
                    F4_DATA: {
                        material: [],
                        customer: [],
                        orderType: [],
                        salesOrg: [],
                        distChannel: [],
                        division: [],
                        plant: [],
                        storageLocation: [],
                        shippingCondition: [],
                        paymentTerms: [],
                        incotermsClassification: [],
                        deliveryBlock: [],
                        billingBlock: []
                    },
                    draftModel: null,
                    newOrder: null,
                    activeOrder: false,
                    isEditing: false,
                    isCreateByContract: false,
                    selectedLineItemIndex: 0,
                    manualPrice: 0,
                    manualDiscount: 0,
                    manualFreight: 0,
                    draftIndicator: "",
                    selectedItemConditions: [],
                    selectedItemScheduleLines: [],
                    selectedScheduleItemNum: "",
                    simulatedLockUser: "",
                    messageLog: []
                });
                oView.setModel(oUIModel, "ui");
            }

            const oList = this.byId("orderList");
            if (oList) {
                oList.attachUpdateFinished(() => {
                    const oUIModel = oView.getModel("ui");
                    const aItems = oList.getItems();
                    if (aItems.length > 0 && !oUIModel.getProperty("/activeOrder")) {
                        oList.setSelectedItem(aItems[0], true);
                        this.onOrderSelect({
                            getParameter: (param) => param === "listItem" ? aItems[0] : null
                        });
                    }
                });
            }

            // Pre-load delivery and billing block F4 data for the Select dropdowns
            this._loadDeliveryBlockF4();
            this._loadBillingBlockF4();
        },

        /* Handle Back-Navigation in SplitApp on mobile viewports */
        onNavBack() {
            const oSplitApp = this.byId("splitApp");
            oSplitApp.backMaster();
        },

        onToggleMaster() {
            const oSplitApp = this.byId("splitApp");
            if (sap.ui.Device.system.phone) {
                oSplitApp.backMaster(); // Navigates back to master list page on phones
            } else {
                if (oSplitApp.isMasterShown()) {
                    oSplitApp.hideMaster();
                } else {
                    oSplitApp.showMaster();
                }
            }
        },

        onMasterClose() {
            const oSplitApp = this.byId("splitApp");
            if (oSplitApp) {
                oSplitApp.hideMaster();
                oSplitApp.toDetail(this.createId("detailPage"));
            }
        },

        /* Model Synchronization Engine - Calculates ATP splits, RVAA01 pricing, and shipping points */
        applyCalculationsAndATP() {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const oDraft = oUIModel.getProperty("/draftModel");
            if (!oDraft) {
                return;
            }

            const aMaterials = oUIModel.getProperty("/F4_DATA/material") || [];
            const aCustomers = oUIModel.getProperty("/F4_DATA/customer") || [];
            const oCustomer = aCustomers.find(c => c.key === oDraft.soldToParty);

            let nTotalDocNet = 0;
            const aItems = oDraft.items || [];

            aItems.forEach((item, index) => {
                const qty = parseFloat(item.qty) || 0;
                const oMat = aMaterials.find(m => m.key === item.material);
                
                // If the F4 data does not have a price (e.g., live OData value helps without price fields), fallback safely
                const matPrice = oMat && oMat.price !== undefined ? parseFloat(oMat.price) : NaN;
                const basePrice = !isNaN(matPrice) ? matPrice : (parseFloat(item.price) || 0);
                
                // Evaluate pricing condition rates (including manual overrides)
                const pr00Rate = item.manualPR00 !== undefined ? parseFloat(item.manualPR00) : basePrice;
                const k004Rate = 0.00; // No automatic discount
                const k007Rate = item.manualK007 !== undefined ? parseFloat(item.manualK007) : 0.00; // No customer discount
                const kf00Rate = item.manualKF00 !== undefined ? parseFloat(item.manualKF00) : 0.00; // No freight surcharge
                
                // Evaluate calculated values
                const pr00Val = pr00Rate * qty;
                const k004Val = pr00Val * (k004Rate / 100);
                const k007Val = pr00Val * (k007Rate / 100);
                const grossVal = pr00Val + k004Val + k007Val;
                const kf00Val = kf00Rate * qty;
                
                const taxRate = item.material === "TG12" ? 0.00 : 19.00; // TG12 is tax exempt, others are standard VAT 19%
                const taxableBase = grossVal + kf00Val;
                const mwstVal = taxableBase * (taxRate / 100);
                const itemNetValue = grossVal + kf00Val + mwstVal;
                
                nTotalDocNet += itemNetValue;
                item.netValue = itemNetValue;
                
                // Build condition rows matching Fiori pricing layout
                item.conditions = [
                    { "step": "11", "type": "PR00", "desc": "Base Price", "rate": pr00Rate.toFixed(2), "base": pr00Val.toFixed(2), "val": pr00Val.toFixed(2) },
                    { "step": "101", "type": "K004", "desc": "Material Discount (-5%)", "rate": k004Rate.toFixed(2) + "%", "base": pr00Val.toFixed(2), "val": k004Val.toFixed(2) },
                    { "step": "105", "type": "K007", "desc": "Customer Discount", "rate": k007Rate.toFixed(2) + "%", "base": pr00Val.toFixed(2), "val": k007Val.toFixed(2) },
                    { "step": "300", "type": "—", "desc": "Gross Value ", "rate": "—", "base": "—", "val": grossVal.toFixed(2) },
                    { "step": "500", "type": "KF00", "desc": "Freight Surcharge", "rate": kf00Rate.toFixed(2), "base": qty.toString(), "val": kf00Val.toFixed(2) },
                    { "step": "800", "type": "MWST", "desc": "Value Added Tax (" + taxRate.toFixed(0) + "%)", "rate": taxRate.toFixed(2) + "%", "base": taxableBase.toFixed(2), "val": mwstVal.toFixed(2) },
                    { "step": "900", "type": "—", "desc": "Net Value (Total Net)", "rate": "—", "base": "—", "val": itemNetValue.toFixed(2) },
                    { "step": "950", "type": "—", "desc": "Tax Amount", "rate": "—", "base": "—", "val": mwstVal.toFixed(2) }
                ];
                
                // Resolve logistical shipping point for this item (SAP requires MaxLength=4)
                // In a real S/4HANA system, this is determined by Shipping Conditions, Loading Group, and Delivering Plant.
                // We will default to the Plant code (which is 4 characters) to avoid the CX_DS_EDM_FACET_ERROR.
                item.shippingPoint = item.plant || "1000";
            });

            // Overall document values
            oDraft.netValue = nTotalDocNet;
            if (aItems.length > 0) {
                oDraft.shippingPoint = aItems[0].shippingPoint;
            } else {
                oDraft.shippingPoint = "N/A";
            }

            // ATP Split Engine: Check material availability against delivery date
            const aScheduleLines = [];
            aItems.forEach(item => {
                const oMat = aMaterials.find(m => m.key === item.material);
                const stock = oMat ? oMat.stock : 10;
                const orderQty = parseFloat(item.qty) || 0;
                const reqDate = (oDraft.generalInfo && oDraft.generalInfo.reqDeliveryDate) || new Date().toISOString().split("T")[0];
                
                if (orderQty <= stock) {
                    // Material IS available on the delivery date → single row, fully confirmed
                    aScheduleLines.push({
                        "itemNum": item.itemNum,
                        "line": "0001",
                        "date": reqDate,
                        "cat": "CP",
                        "orderQty": orderQty,
                        "confQty": orderQty,
                        "movType": "601"
                    });
                } else {
                    // Material NOT available on delivery date → 2 rows:
                    // Row 1: Delivery date with full ordered qty but 0 confirmed (not available)
                    aScheduleLines.push({
                        "itemNum": item.itemNum,
                        "line": "0001",
                        "date": reqDate,
                        "cat": "CP",
                        "orderQty": orderQty,
                        "confQty": 0,
                        "movType": "601"
                    });
                    
                    // Row 2: Available date (delivery + 10 days) with full confirmed qty
                    const availableDate = new Date(reqDate);
                    availableDate.setDate(availableDate.getDate() + 10);
                    const availDateString = availableDate.toISOString().split("T")[0];
                    
                    aScheduleLines.push({
                        "itemNum": item.itemNum,
                        "line": "0002",
                        "date": availDateString,
                        "cat": "CP",
                        "orderQty": 0,
                        "confQty": orderQty,
                        "movType": "601"
                    });
                }
            });
            oDraft.scheduleLines = aScheduleLines;

            // Update conditions bound to selected line item
            const selectedIndex = oUIModel.getProperty("/selectedLineItemIndex") || 0;
            if (aItems[selectedIndex]) {
                oUIModel.setProperty("/selectedItemConditions", aItems[selectedIndex].conditions);
                oUIModel.setProperty("/selectedItemNum", aItems[selectedIndex].itemNum);
                this._updateSelectedPricingSummary(oUIModel, aItems[selectedIndex]);
            } else {
                oUIModel.setProperty("/selectedItemConditions", []);
                oUIModel.setProperty("/selectedItemNum", "");
                this._updateSelectedPricingSummary(oUIModel, null);
            }

            // Update schedule lines filtered by selected item
            this._updateSelectedScheduleLines(oUIModel, oDraft);

            // Perform dynamic Customer KPI updates
            if (oCustomer) {
                const creditLimit = oCustomer.creditLimit || 0;
                const creditUsed = oCustomer.creditUsed || 0;
                oUIModel.setProperty("/creditLimitText", "₹" + creditUsed.toLocaleString() + " of ₹" + creditLimit.toLocaleString());
                oUIModel.setProperty("/creditPercent", creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0);
                oUIModel.setProperty("/creditYtdSales", oCustomer.ytdSales || 0);
            } else {
                oUIModel.setProperty("/creditLimitText", "N/A");
                oUIModel.setProperty("/creditPercent", 0);
                oUIModel.setProperty("/creditYtdSales", 0);
            }

            oUIModel.setProperty("/draftIndicator", "Saved");
            oUIModel.updateBindings(true);
        },

        /* Master Page Search */
        onSearch(oEvent) {
            const sQuery = oEvent.getParameter("newValue") || oEvent.getParameter("query") || "";
            const oList = this.byId("orderList");
            const oBinding = oList.getBinding("items");

            let aFilters = [];
            if (sQuery && sQuery.length > 0) {
                const oFilterOrder = new Filter("salesOrder", FilterOperator.Contains, sQuery);
                const oFilterCustomer = new Filter("soldToParty", FilterOperator.Contains, sQuery);
                const oFilterPO = new Filter("poNumber", FilterOperator.Contains, sQuery);
                aFilters.push(new Filter({
                    filters: [oFilterOrder, oFilterCustomer, oFilterPO],
                    and: false
                }));
            }
            oBinding.filter(aFilters);
        },

        /* Order Selection from Master List */
        onOrderSelect(oEvent) {
            const oItem = oEvent.getParameter("listItem");
            if (!oItem) {
                return;
            }
            const oCtx = oItem.getBindingContext();
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");

            oUIModel.setProperty("/activeOrder", true);
            oUIModel.setProperty("/isEditing", false);
            oUIModel.setProperty("/selectedLineItemIndex", 0);

            const sPath = oCtx.getPath(); // Extract exactly how OData V4 identifies the record
            oCtx.requestObject("").then((oHeader) => {
                if (!oHeader) {
                    MessageBox.error("Failed to read selection context.");
                    return;
                }
                // Manually fetch the deep entity to bypass UI5 OData V4 model stripping navigation arrays
                const sUrl = `/sales-order${sPath}?$expand=items,partners,scheduleLines,pricingConditions,generalInfo,shippingRoute,billingFinancial,kpis,orderCreationInit`;
                
                fetch(sUrl)
                    .then(response => response.json())
                    .then(oDeepOrder => {
                        const oDraftCopy = JSON.parse(JSON.stringify(oDeepOrder));
                        
                        
                        // Restore saved pricing conditions back to item level
                        if (oDraftCopy.pricingConditions && oDraftCopy.pricingConditions.length > 0) {
                            if (oDraftCopy.items && oDraftCopy.items.length > 0) {
                                oDraftCopy.items.forEach(item => {
                                    const matchingConditions = oDraftCopy.pricingConditions.filter(pc => pc.itemNum === item.itemNum);
                                    if (matchingConditions.length > 0) {
                                        item.conditions = matchingConditions;
                                    } else if (!item.conditions) {
                                        // Fallback for legacy data without itemNum
                                        item.conditions = oDraftCopy.pricingConditions;
                                    }
                                });
                            }
                        }

                        oUIModel.setProperty("/draftModel", oDraftCopy);
                        
                        // Avoid recalculating if we already have saved conditions
                        if (!oDraftCopy.pricingConditions || oDraftCopy.pricingConditions.length === 0) {
                            this.applyCalculationsAndATP();
                        } else {
                            // Update the summary and bind conditions for the selected item
                            if (oDraftCopy.items && oDraftCopy.items.length > 0) {
                                const firstItem = oDraftCopy.items[0];
                                oUIModel.setProperty("/selectedItemConditions", firstItem.conditions || []);
                                oUIModel.setProperty("/selectedItemNum", firstItem.itemNum || "");
                                this._updateSelectedPricingSummary(oUIModel, firstItem);
                            }
                            // Update schedule lines filtered by selected item
                            this._updateSelectedScheduleLines(oUIModel, oDraftCopy);
                        }

                        if (oDraftCopy.items && oDraftCopy.items[0]) {
                            const firstItem = oDraftCopy.items[0];
                            oUIModel.setProperty("/manualPrice", firstItem.manualPR00 !== undefined ? firstItem.manualPR00 : firstItem.price);
                            oUIModel.setProperty("/manualDiscount", firstItem.manualK007 !== undefined ? firstItem.manualK007 : -2.50);
                            oUIModel.setProperty("/manualFreight", firstItem.manualKF00 !== undefined ? firstItem.manualKF00 : 10.00);
                        }

                        const oSplitApp = this.byId("splitApp");
                        if (oSplitApp) {
                            oSplitApp.hideMaster();
                            oSplitApp.toDetail(this.createId("detailPage"));
                        }
                    })
                    .catch(err => {
                        MessageBox.error("Failed to fetch deep order details: " + err.message);
                    });
            });
        },

        /* Create Order (VA01 Fiori Screen Launch) */
        onCreateOrder() {
            const oUIModel = this.getView().getModel("ui");
            oUIModel.setProperty("/isCreateByContract", false);
            oUIModel.setProperty("/newOrder", {
                orderType: "",
                salesOrg: "",
                distChannel: "",
                division: "",
                soldToParty: "",
                salesContract: ""
            });

            const oView = this.getView();
            if (!this.pDialog) {
                this.pDialog = Fragment.load({
                    id: oView.getId(),
                    name: "salesorder.view.CreateOrderDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }

            this.pDialog.then(function(oDialog) {
                oDialog.open();
            }).catch(err => {
                MessageBox.error("Fragment load error: " + err.message);
                this.pDialog = null; // Reset to allow retry
            });
        },

        onCreateOrderByContract() {
            const oUIModel = this.getView().getModel("ui");
            oUIModel.setProperty("/isCreateByContract", true);
            oUIModel.setProperty("/newOrder", {
                orderType: "",
                salesOrg: "",
                distChannel: "",
                division: "",
                soldToParty: "",
                salesContract: ""
            });

            const oView = this.getView();
            if (!this.pDialog) {
                this.pDialog = Fragment.load({
                    id: oView.getId(),
                    name: "salesorder.view.CreateOrderDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }

            this.pDialog.then(function(oDialog) {
                oDialog.open();
            }).catch(err => {
                MessageBox.error("Fragment load error: " + err.message);
                this.pDialog = null; // Reset to allow retry
            });
        },

        onCancelCreate() {
            const oUIModel = this.getView().getModel("ui");
            oUIModel.setProperty("/isCreateByContract", false);
            if (this.pDialog) {
                this.pDialog.then(function(oDialog) {
                    oDialog.close();
                });
            }
        },

        onContinueCreate() {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const newOrderData = oUIModel.getProperty("/newOrder");

            if (this.pDialog) {
                this.pDialog.then(function(oDialog) {
                    oDialog.close();
                });
            }

            oUIModel.setProperty("/isCreateByContract", false);

            // Simulate CAPM Orchestration delay
            oUIModel.setProperty("/draftIndicator", "Saving");
            setTimeout(() => {
                oUIModel.setProperty("/draftIndicator", "Saved");
            }, 800);

            // Unselect Master list selection
            const oList = this.byId("orderList");
            if (oList) {
                oList.removeSelections(true);
            }

            oUIModel.setProperty("/activeOrder", true);
            oUIModel.setProperty("/isEditing", true);
            oUIModel.setProperty("/selectedLineItemIndex", 0);

            // Seed fresh draft sales order
            const generatedDraftNo = "Draft-" + Math.floor(1000 + Math.random() * 9000);
            
            // Resolve customer for Sold-To
            const aCustomers = oUIModel.getProperty("/F4_DATA/customer") || [];
            const oCustomer = aCustomers.find(c => c.key === newOrderData.soldToParty) || aCustomers[0];

            const freshDraft = {
                salesOrder: generatedDraftNo,
                orderType: newOrderData.orderType,
                netValue: 0,
                docCurrency: "INR",
                soldToParty: newOrderData.soldToParty,
                docDate: new Date().toISOString().split("T")[0],
                shippingPoint: "",
                poNumber: "",
                status: "Own Draft",
                lockedBy: "",
                salesContract: newOrderData.salesContract || "",
                
                orderCreationInit: {
                    orderType: newOrderData.orderType,
                    salesOrg: newOrderData.salesOrg,
                    distChannel: newOrderData.distChannel,
                    division: newOrderData.division,
                    soldToParty: newOrderData.soldToParty
                },
                generalInfo: {
                    orderType: newOrderData.orderType,
                    salesOrg: newOrderData.salesOrg,
                    distChannel: newOrderData.distChannel,
                    division: newOrderData.division,
                    soldToParty: newOrderData.soldToParty,
                    shipToParty: newOrderData.soldToParty,
                    poNumber: "",
                    poDate: null,
                    docDate: new Date().toISOString().split("T")[0],
                    reqDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                    salesOffice: "",
                    salesGroup: ""
                },
                shippingRoute: {
                    shippingConditions: "",
                    shippingPoint: "",
                    route: "",
                    loadingGroup: ""
                },
                billingFinancial: {
                    paymentTerms: oCustomer ? oCustomer.paymentTerms : "",
                    incotermsPart1: oCustomer ? oCustomer.incoterms1 : "",
                    incotermsPart2: oCustomer ? oCustomer.incoterms2 : "",
                    incotermsLocation: oCustomer ? oCustomer.incoterms2 : "",
                    billingBlock: "",
                    deliveryBlock: "",
                    docCurrency: "INR"
                },
                items: [],
                partners: [],
                pricingConditions: [],
                scheduleLines: []
            };

            oUIModel.setProperty("/draftModel", freshDraft);
            this.applyCalculationsAndATP();

            // Populate manual pricing inputs (only if items exist)
            const firstItem = freshDraft.items[0];
            if (firstItem) {
                oUIModel.setProperty("/manualPrice", firstItem.price || 0);
                oUIModel.setProperty("/manualDiscount", -2.50);
                oUIModel.setProperty("/manualFreight", 10.00);
            } else {
                oUIModel.setProperty("/manualPrice", 0);
                oUIModel.setProperty("/manualDiscount", -2.50);
                oUIModel.setProperty("/manualFreight", 10.00);
            }

            // On phone/mobile viewports, transition to show the Detail page
            const oSplitApp = this.byId("splitApp");
            if (oSplitApp) {
                oSplitApp.toDetail("detailPage");
            }

            MessageToast.show("VA01: New Draft Sales Order Created in transient memory");
        },

        /* Switch Active Order to Edit Mode (VA02 Fiori Launch) */
        onEditOrder() {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const sLockedBy = oUIModel.getProperty("/simulatedLockUser");
            if (sLockedBy) {
                MessageBox.error("Cannot edit: Exclusive document lock held by session '" + sLockedBy + "'.");
                return;
            }

            oUIModel.setProperty("/isEditing", true);
            oUIModel.setProperty("/draftIndicator", "Saving");
            setTimeout(() => {
                oUIModel.setProperty("/draftIndicator", "Saved");
                oUIModel.updateBindings(true);
            }, 800);

            const oDraft = oUIModel.getProperty("/draftModel");
            const selectedIndex = oUIModel.getProperty("/selectedLineItemIndex") || 0;
            if (oDraft.items && oDraft.items[selectedIndex]) {
                const curItem = oDraft.items[selectedIndex];
                oUIModel.setProperty("/manualPrice", curItem.manualPR00 !== undefined ? curItem.manualPR00 : curItem.price);
                oUIModel.setProperty("/manualDiscount", curItem.manualK007 !== undefined ? curItem.manualK007 : 0.00);
                oUIModel.setProperty("/manualFreight", curItem.manualKF00 !== undefined ? curItem.manualKF00 : 0.00);
            }

            MessageToast.show("VA02: switched to sandboxed draft editing.");
        },

        /* Delete Order */
        onDeleteOrder() {
            MessageBox.confirm("Are you sure you want to delete this Sales Order?", {
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                onClose: (oAction) => {
                    if (oAction === MessageBox.Action.YES) {
                        const oUIModel = this.getView().getModel("ui");
                        const oDraft = oUIModel.getProperty("/draftModel");
                        const oList = this.byId("orderList");
                        const oListBinding = oList ? oList.getBinding("items") : null;
 
                        const fnOnSuccess = () => {
                            MessageToast.show("Sales Order successfully deleted.");
                            oUIModel.setProperty("/activeOrder", false);
                            oUIModel.setProperty("/draftModel", null);
                            if (oListBinding) {
                                oListBinding.refresh();
                            }
                        };
 
                        const oSelectedItem = oList ? oList.getSelectedItem() : null;
                        if (oSelectedItem) {
                            const oCtx = oSelectedItem.getBindingContext();
                            oCtx.delete().then(fnOnSuccess).catch((err) => {
                                MessageBox.error("Failed to delete Sales Order: " + err.message);
                            });
                        } else if (oDraft && oDraft.ID) {
                            fetch(`/sales-order/SalesOrders(${oDraft.ID})`, {
                                method: "DELETE"
                            })
                            .then((response) => {
                                if (!response.ok) {
                                    throw new Error("Failed to delete from backend.");
                                }
                                fnOnSuccess();
                            })
                            .catch((err) => {
                                MessageBox.error("Failed to delete Sales Order: " + err.message);
                            });
                        } else {
                            MessageBox.error("No active order selected for deletion.");
                        }
                    }
                }
            });
        },

        /* Discard Current Changes */
        onDiscardDraft() {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            
            MessageBox.confirm("Are you sure you want to discard your changes?", {
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                onClose: (oAction) => {
                    if (oAction === MessageBox.Action.YES) {
                        const oList = this.byId("orderList");
                        const oSelectedItem = oList ? oList.getSelectedItem() : null;

                        if (oSelectedItem) {
                            // Revert by re-cloning original VBAK database entry
                            const oSelectedOrder = oSelectedItem.getBindingContext().getObject();
                            oUIModel.setProperty("/draftModel", JSON.parse(JSON.stringify(oSelectedOrder)));
                            oUIModel.setProperty("/isEditing", false);
                            this.applyCalculationsAndATP();
                            MessageToast.show("Changes discarded. Sandboxed locks released.");
                        } else {
                            // Close detail page if discard occurred on new VA01 creation
                            oUIModel.setProperty("/activeOrder", false);
                            oUIModel.setProperty("/isEditing", false);
                            oUIModel.setProperty("/draftModel", null);
                            MessageToast.show("Draft discarded.");
                        }
                    }
                }
            });
        },

        /* Save Order (VBAK/VBAP commits) */
        onSaveOrder() {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const oDraft = oUIModel.getProperty("/draftModel");
 
            if (!oDraft.soldToParty) {
                MessageBox.error("Pre-flight check failed: Sold-To Customer party is required.");
                return;
            }
 
            if (!oDraft.items || oDraft.items.length === 0) {
                MessageBox.error("Pre-flight check failed: Cannot save a sales document with 0 items.");
                return;
            }
 
            // Verify lines have material number
            let bHasInvalidItem = false;
            oDraft.items.forEach(item => {
                if (!item.material || parseFloat(item.qty) <= 0) {
                    bHasInvalidItem = true;
                }
            });
 
            if (bHasInvalidItem) {
                MessageBox.error("Pre-flight check failed: Ensure all items have a material and quantity greater than 0.");
                return;
            }
 
            // Before cloning, always aggregate item-level pricing conditions into the
            // root pricingConditions array so they are persisted to the backend.
            // Previously this was only done after simulation, meaning locally-calculated
            // conditions (from applyCalculationsAndATP) were lost on save/refresh.
            const aAllPricingConditions = [];
            if (oDraft.items && oDraft.items.length > 0) {
                oDraft.items.forEach(item => {
                    if (item.conditions && item.conditions.length > 0) {
                        item.conditions.forEach(cond => {
                            aAllPricingConditions.push({
                                step: cond.step || "",
                                itemNum: cond.itemNum || item.itemNum || "",
                                type: cond.type || "",
                                desc: cond.desc || "",
                                rate: cond.rate !== undefined ? String(cond.rate) : "",
                                base: cond.base !== undefined ? String(cond.base) : "",
                                val: typeof cond.val === "string" ? parseFloat(cond.val) || 0 : (cond.val || 0),
                                isStat: !!cond.isStat
                            });
                        });
                    }
                });
            }
            if (aAllPricingConditions.length > 0) {
                oDraft.pricingConditions = aAllPricingConditions;
            }

            // Create a clean clone of the draft payload to avoid sending UI-only fields (which CAP rejects)
            const oCleanDraft = JSON.parse(JSON.stringify(oDraft));
            
            // Helper: recursively strip any property ending in "Desc" from an object (virtual UI-only fields)
            // Also strip metadata fields starting with "@" (like @$ui5.context.isTransient)
            const stripVirtualFields = (obj) => {
                if (!obj || typeof obj !== "object") return obj;
                if (Array.isArray(obj)) return obj.map(stripVirtualFields);
                const clean = {};
                // Fields that exist only in the UI and are NOT in the CAP schema
                const UI_ONLY_KEYS = new Set([
                    "conditions", "manualPR00", "manualK007", "manualKF00",
                    "_simulatedScheduleLines", "selectedItemConditions",
                    "selectedItemQty", "selectedItemNet", "selectedItemTax"
                ]);
                for (const key of Object.keys(obj)) {
                    if (key.endsWith("Desc")) continue; // Skip virtual description fields
                    if (key.startsWith("@")) continue; // Skip UI5/OData metadata fields
                    if (key.startsWith("_")) continue; // Skip internal/transient fields
                    if (UI_ONLY_KEYS.has(key)) continue;
                    const val = obj[key];
                    if (Array.isArray(val)) {
                        clean[key] = val.map(stripVirtualFields);
                    } else if (val !== null && typeof val === "object" && !(val instanceof Date)) {
                        clean[key] = stripVirtualFields(val);
                    } else {
                        clean[key] = val;
                    }
                }
                return clean;
            };
            
            // Clean ALL compositions recursively
            const oStrippedDraft = stripVirtualFields(oCleanDraft);

            // Additionally ensure items have only valid CAP fields
            if (oStrippedDraft.items) {
                oStrippedDraft.items = oStrippedDraft.items.map(item => {
                    const cleanItem = {
                        itemNum: item.itemNum,
                        material: item.material,
                        desc: item.desc,
                        qty: parseFloat(item.qty) || 0,
                        uom: item.uom,
                        plant: item.plant,
                        storLoc: item.storLoc,
                        itemCategory: item.itemCategory,
                        price: parseFloat(item.price) || 0,
                        netValue: parseFloat(item.netValue) || 0,
                        shippingPoint: item.shippingPoint
                    };
                    if (item.ID) {
                        cleanItem.ID = item.ID;
                    }
                    return cleanItem;
                });
            }

            // Clean scheduleLines to only include valid CAP fields
            if (oStrippedDraft.scheduleLines) {
                oStrippedDraft.scheduleLines = oStrippedDraft.scheduleLines.map(sl => {
                    const cleanSL = {
                        itemNum: sl.itemNum,
                        line: sl.line,
                        date: (!sl.date || sl.date === "") ? null : sl.date,
                        cat: sl.cat,
                        orderQty: parseFloat(sl.orderQty) || 0,
                        confQty: parseFloat(sl.confQty) || 0,
                        uom: sl.uom || "",
                        deliveryBlock: sl.deliveryBlock || "",
                        movType: sl.movType
                    };
                    if (sl.ID) cleanSL.ID = sl.ID;
                    return cleanSL;
                });
            }

            // Clean partners
            if (oStrippedDraft.partners) {
                oStrippedDraft.partners = oStrippedDraft.partners.map(p => {
                    const cleanP = {
                        role: p.role,
                        desc: p.desc,
                        partnerId: p.partnerId,
                        name: p.name,
                        address: p.address
                    };
                    if (p.ID) cleanP.ID = p.ID;
                    return cleanP;
                });
            }

            // Clean pricingConditions
            if (oStrippedDraft.pricingConditions) {
                oStrippedDraft.pricingConditions = oStrippedDraft.pricingConditions.map(pc => {
                    const cleanPC = {
                        step: pc.step,
                        itemNum: pc.itemNum,
                        type: pc.type,
                        desc: pc.desc,
                        rate: pc.rate,
                        base: pc.base,
                        val: typeof pc.val === "string" ? parseFloat(pc.val) : (pc.val || 0),
                        isStat: !!pc.isStat
                    };
                    if (pc.ID) cleanPC.ID = pc.ID;
                    return cleanPC;
                });
            }

            // Clean generalInfo
            if (oStrippedDraft.generalInfo) {
                const g = oStrippedDraft.generalInfo;
                oStrippedDraft.generalInfo = {
                    orderType: g.orderType,
                    salesOrg: g.salesOrg,
                    distChannel: g.distChannel,
                    division: g.division,
                    soldToParty: g.soldToParty,
                    shipToParty: g.shipToParty,
                    poNumber: g.poNumber,
                    poDate: (!g.poDate || g.poDate === "") ? null : g.poDate,
                    docDate: (!g.docDate || g.docDate === "") ? null : g.docDate,
                    reqDeliveryDate: (!g.reqDeliveryDate || g.reqDeliveryDate === "") ? null : g.reqDeliveryDate,
                    salesOffice: g.salesOffice,
                    salesGroup: g.salesGroup
                };
                if (g.ID) oStrippedDraft.generalInfo.ID = g.ID;
            }

            // Ensure root docDate is null instead of empty string
            if (!oStrippedDraft.docDate || oStrippedDraft.docDate === "") {
                oStrippedDraft.docDate = null;
            }

            // Clean shippingRoute
            if (oStrippedDraft.shippingRoute) {
                const s = oStrippedDraft.shippingRoute;
                oStrippedDraft.shippingRoute = {
                    shippingConditions: s.shippingConditions,
                    shippingType: s.shippingType,
                    shippingPoint: s.shippingPoint,
                    route: s.route,
                    loadingGroup: s.loadingGroup
                };
                if (s.ID) oStrippedDraft.shippingRoute.ID = s.ID;
            }

            // Clean billingFinancial
            if (oStrippedDraft.billingFinancial) {
                const b = oStrippedDraft.billingFinancial;
                oStrippedDraft.billingFinancial = {
                    paymentTerms: b.paymentTerms,
                    incotermsPart1: b.incotermsPart1,
                    incotermsPart2: b.incotermsPart2,
                    incotermsLocation: b.incotermsLocation,
                    billingBlock: b.billingBlock,
                    deliveryBlock: b.deliveryBlock,
                    docCurrency: b.docCurrency
                };
                if (b.ID) oStrippedDraft.billingFinancial.ID = b.ID;
            }

            // Clean orderCreationInit
            if (oStrippedDraft.orderCreationInit) {
                const o = oStrippedDraft.orderCreationInit;
                oStrippedDraft.orderCreationInit = {
                    orderType: o.orderType,
                    salesOrg: o.salesOrg,
                    distChannel: o.distChannel,
                    division: o.division,
                    soldToParty: o.soldToParty
                };
                if (o.ID) oStrippedDraft.orderCreationInit.ID = o.ID;
            }

            // Clean kpis
            if (oStrippedDraft.kpis && oStrippedDraft.kpis.length > 0) {
                oStrippedDraft.kpis = oStrippedDraft.kpis.map(k => {
                    const cleanK = {
                        creditLimitValue: parseFloat(k.creditLimitValue) || 0,
                        creditLimitTotal: parseFloat(k.creditLimitTotal) || 0,
                        creditUsePercentage: parseFloat(k.creditUsePercentage) || 0,
                        ytdSalesVolume: parseFloat(k.ytdSalesVolume) || 0,
                        fiscalYearPeriod: k.fiscalYearPeriod,
                        currency: k.currency
                    };
                    if (k.ID) cleanK.ID = k.ID;
                    return cleanK;
                });
            }

            try {
                // Persist via OData V4 Deep Insert or Update
                oDraft.status = "Active Version";
                oStrippedDraft.status = "Active Version";

                // Get the existing List Binding from the Master List
                const oList = this.byId("orderList");
                const oListBinding = oList.getBinding("items");
                
                // If it has an ID, it already exists on the backend, so we UPDATE (PATCH).
                // If it does not have an ID, it is a brand new draft, so we CREATE (POST).
                if (oStrippedDraft.ID) {
                    // To prevent sending virtual properties and to send a minimal payload
                    // we compute a diff against the original object state
                    const oSelectedItem = oList.getSelectedItem();
                    const oOriginal = oSelectedItem ? oSelectedItem.getBindingContext().getObject() : {};
                    const oPatchPayload = {};

                    // Extract only properties that have changed
                    for (const key in oStrippedDraft) {
                        if (typeof oStrippedDraft[key] !== "object") {
                            // Only add primitive fields if their value differs from the original
                            if (oStrippedDraft[key] !== oOriginal[key]) {
                                oPatchPayload[key] = oStrippedDraft[key];
                            }
                        } else if (Array.isArray(oStrippedDraft[key])) {
                            // Always include child collections (like items) to ensure deep updates work
                            oPatchPayload[key] = oStrippedDraft[key];
                        } else if (oStrippedDraft[key] !== null) {
                            // Include composition objects (shippingRoute, billingFinancial, generalInfo, etc.)
                            oPatchPayload[key] = oStrippedDraft[key];
                        }
                    }

                    fetch(`/sales-order/SalesOrders(${oStrippedDraft.ID})`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(oPatchPayload)
                    })
                    .then(async (response) => {
                        if (!response.ok) {
                            const errBody = await response.text();
                            throw new Error(errBody);
                        }
                        const oUpdatedObject = await response.json();
                        
                        // Merge the patched response (which only has changed fields) back into the full draft
                        // so we don't wipe out unmodified fields from the UI
                        const oMergedDraft = Object.assign({}, oDraft, oUpdatedObject);
                        
                        // Deep restore of item UI state since Object.assign is shallow
                        if (oMergedDraft.items && oDraft.items) {
                            oMergedDraft.items.forEach((item, index) => {
                                const oldItem = oDraft.items.find(i => i.itemNum === item.itemNum) || oDraft.items[index];
                                if (oldItem) {
                                    item.conditions = oldItem.conditions;
                                }
                            });
                        }
                        
                        // Override with backend pricing conditions if CAP returned them
                        if (oMergedDraft.pricingConditions && oMergedDraft.pricingConditions.length > 0) {
                            if (oMergedDraft.items && oMergedDraft.items.length > 0) {
                                oMergedDraft.items.forEach(item => {
                                    const matchingConditions = oMergedDraft.pricingConditions.filter(pc => pc.itemNum === item.itemNum);
                                    if (matchingConditions.length > 0) {
                                        item.conditions = matchingConditions;
                                    } else if (!item.conditions) {
                                        item.conditions = oMergedDraft.pricingConditions;
                                    }
                                });
                            }
                        }

                        oUIModel.setProperty("/draftModel", oMergedDraft);
                        
                        oUIModel.setProperty("/isEditing", false);
                        
                        if (oMergedDraft.items && oMergedDraft.items.length > 0) {
                            const firstItem = oMergedDraft.items[0];
                            oUIModel.setProperty("/selectedItemConditions", firstItem.conditions || []);
                            oUIModel.setProperty("/selectedItemNum", firstItem.itemNum || "");
                            this._updateSelectedPricingSummary(oUIModel, firstItem);
                        }
                        
                        oListBinding.refresh(); // Refresh list to reflect changes
                        
                        // Automatically push to SAP if the order already exists there
                        if (oDraft.sapOrderId) {
                            MessageToast.show("Draft updated locally. Pushing changes to SAP...");
                            this.onSendToSAP();
                        } else {
                            MessageToast.show("Sales Order " + oDraft.salesOrder + " successfully updated locally.");
                        }
                    })
                    .catch((err) => {
                        MessageBox.error("Backend Error during Update: " + err.message);
                    });
                } else {
                    // CREATE via direct fetch POST (avoids UI5 OData V4 model injecting unknown fields)
                    fetch(`/sales-order/SalesOrders`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(oStrippedDraft)
                    })
                    .then(async (response) => {
                        if (!response.ok) {
                            const errBody = await response.text();
                            throw new Error(errBody);
                        }
                        const oCreatedObject = await response.json();

                        // Merge the created object back into the draft to retain UI-only fields (conditions, etc.)
                        const oMergedDraft = Object.assign({}, oDraft, oCreatedObject);
                        
                        // Deep restore of item UI state since Object.assign is shallow
                        if (oMergedDraft.items && oDraft.items) {
                            oMergedDraft.items.forEach((item, index) => {
                                const oldItem = oDraft.items.find(i => i.itemNum === item.itemNum) || oDraft.items[index];
                                if (oldItem) {
                                    item.conditions = oldItem.conditions;
                                }
                            });
                        }
                        
                        // Override with backend pricing conditions if CAP returned them
                        if (oMergedDraft.pricingConditions && oMergedDraft.pricingConditions.length > 0) {
                            if (oMergedDraft.items && oMergedDraft.items.length > 0) {
                                oMergedDraft.items.forEach(item => {
                                    const matchingConditions = oMergedDraft.pricingConditions.filter(pc => pc.itemNum === item.itemNum);
                                    if (matchingConditions.length > 0) {
                                        item.conditions = matchingConditions;
                                    } else if (!item.conditions) {
                                        item.conditions = oMergedDraft.pricingConditions;
                                    }
                                });
                            }
                        }

                        oUIModel.setProperty("/draftModel", JSON.parse(JSON.stringify(oMergedDraft)));
                        oUIModel.setProperty("/isEditing", false);
                        
                        if (oMergedDraft.items && oMergedDraft.items.length > 0) {
                            const firstItem = oMergedDraft.items[0];
                            oUIModel.setProperty("/selectedItemConditions", firstItem.conditions || []);
                            oUIModel.setProperty("/selectedItemNum", firstItem.itemNum || "");
                            this._updateSelectedPricingSummary(oUIModel, firstItem);
                        }
                        
                        // Refresh the master list to show the newly created order
                        oListBinding.refresh();
                        
                        MessageToast.show("Sales Order " + oCreatedObject.salesOrder + " successfully created.");
                    })
                    .catch((err) => {
                        MessageBox.error("Backend Error during Create: " + err.message);
                    });
                }
 
            } catch (err) {
                MessageBox.error("Failed to process Sales Order: " + err.message);
            }
        },

        /* Toggle Simulated Session Lock */
        onToggleLock() {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const sLock = oUIModel.getProperty("/simulatedLockUser");
            if (sLock) {
                oUIModel.setProperty("/simulatedLockUser", "");
                MessageToast.show("Document lock released. Edit mode is now available.");
            } else {
                oUIModel.setProperty("/simulatedLockUser", "SYSTEM_AGENT_99");
                oUIModel.setProperty("/isEditing", false); // Kick out of editing
                MessageToast.show("Exclusive S/4HANA lock set by SYSTEM_AGENT_99.");
            }
            oUIModel.updateBindings(true);
        },

        /* Line Items Management */
        onAddItem() {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const aItems = oUIModel.getProperty("/draftModel/items") || [];
 
            const nextItemNo = String((aItems.length + 1) * 10);
            aItems.push({
                itemNum: nextItemNo,
                material: "",
                desc: "",
                qty: 1,
                uom: "",
                plant: "",
                storLoc: "",
                itemCategory: "TAN",
                price: 0.00,
                netValue: 0.00,
                isNewToSAP: true
            });
 
            oUIModel.setProperty("/draftModel/items", aItems);
            this.applyCalculationsAndATP();
            
            // Select new item in dropdown
            const newIndex = aItems.length - 1;
            oUIModel.setProperty("/selectedLineItemIndex", newIndex);
            
            // Trigger override values reset for the newly added item
            const newItem = aItems[newIndex];
            oUIModel.setProperty("/manualPrice", newItem.price);
            oUIModel.setProperty("/manualDiscount", 0);
            oUIModel.setProperty("/manualFreight", 0);
 
            this.applyCalculationsAndATP();
        },

        onDeleteItem(oEvent) {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const oItem = oEvent.getSource().getParent();
            const oCtx = oItem.getBindingContext("ui");
            const sPath = oCtx.getPath();
            const nIndex = parseInt(sPath.split("/").pop(), 10);

            const aItems = oUIModel.getProperty("/draftModel/items");
            const oDeletedItem = aItems[nIndex];
            
            // Track deleted items that already exist in SAP (not newly added ones)
            // so we can send DELETE requests to SAP on save
            const sSapOrderId = oUIModel.getProperty("/draftModel/sapOrderId");
            if (sSapOrderId && oDeletedItem && !oDeletedItem.isNewToSAP) {
                const aDeletedSAPItems = oUIModel.getProperty("/deletedSAPItems") || [];
                aDeletedSAPItems.push({
                    sapOrderId: sSapOrderId,
                    itemNum: oDeletedItem.itemNum
                });
                oUIModel.setProperty("/deletedSAPItems", aDeletedSAPItems);
            }
            
            aItems.splice(nIndex, 1);

            // Resequence items
            aItems.forEach((item, idx) => {
                item.itemNum = String((idx + 1) * 10);
            });

            oUIModel.setProperty("/draftModel/items", aItems);
            oUIModel.setProperty("/selectedLineItemIndex", 0);
            this.applyCalculationsAndATP();
            
            MessageToast.show("Line item deleted and pricing re-evaluated.");
        },

        /* Switch to Pricing Conditions for specific item */
        onSelectConditions(oEvent) {
            const oButton = oEvent.getSource();
            // In the XML, itemsTable is bound using items="{ui>/draftModel/items}"
            // so the context path relative to the ui model is e.g. "/draftModel/items/0"
            const oContext = oButton.getBindingContext("ui");
            const sPath = oContext.getPath();
            const aParts = sPath.split("/");
            const iIndex = parseInt(aParts[aParts.length - 1], 10);
            
            const oUIModel = this.getView().getModel("ui");
            oUIModel.setProperty("/selectedLineItemIndex", iIndex);
            
            // Re-populate the manual pricing properties for the newly selected index
            const oDraft = oUIModel.getProperty("/draftModel");
            if (oDraft.items && oDraft.items[iIndex]) {
                const curItem = oDraft.items[iIndex];
                oUIModel.setProperty("/selectedItemNum", curItem.itemNum);
                oUIModel.setProperty("/selectedItemConditions", curItem.conditions || []);
                this._updateSelectedPricingSummary(oUIModel, curItem);
                oUIModel.setProperty("/manualPrice", curItem.manualPR00 !== undefined ? curItem.manualPR00 : curItem.price);
                oUIModel.setProperty("/manualDiscount", curItem.manualK007 !== undefined ? curItem.manualK007 : -2.50);
                oUIModel.setProperty("/manualFreight", curItem.manualKF00 !== undefined ? curItem.manualKF00 : 10.00);
            }

            const oIconTabBar = this.byId("idIconTabBar");
            if (oIconTabBar) {
                oIconTabBar.setSelectedKey("pricing");
            }
        },

        onItemChange(oEvent) {
            const oInput = oEvent.getSource();
            const oCtx = oInput.getBindingContext("ui");
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const sPath = oCtx.getPath();
            
            const bindingInfo = oInput.getBindingInfo("value");
            const sChangedField = bindingInfo && bindingInfo.parts && bindingInfo.parts[0] ? bindingInfo.parts[0].path : "";

            // Only auto-fill material data if the Material field itself was the one changed
            if (sChangedField === "material") {
                const sMaterial = oUIModel.getProperty(sPath + "/material");
                const aMaterials = oUIModel.getProperty("/F4_DATA/material") || [];
                const oMat = aMaterials.find(m => m.key === sMaterial);

                if (oMat) {
                    oUIModel.setProperty(sPath + "/desc", oMat.desc);
                    
                    // Only overwrite these if the OData material entity actually provides them
                    if (oMat.price !== undefined) oUIModel.setProperty(sPath + "/price", oMat.price);
                    if (oMat.uom !== undefined) oUIModel.setProperty(sPath + "/uom", oMat.uom);
                    if (oMat.defaultPlant !== undefined) oUIModel.setProperty(sPath + "/plant", oMat.defaultPlant);
                    
                    // Clear any manual overrides when a brand new material is chosen
                    oUIModel.setProperty(sPath + "/manualPR00", undefined);
                    oUIModel.setProperty(sPath + "/manualK007", undefined);
                    oUIModel.setProperty(sPath + "/manualKF00", undefined);
                }
            }

            this.applyCalculationsAndATP();
        },

        onHeaderChange(oEvent) {
            // Recalculates partner matrices and customer details when sold-to party changes
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const oDraft = oUIModel.getProperty("/draftModel");
            if (!oDraft) return;

            // Determine which field triggered the change
            let sChangedField = "";
            if (oEvent && oEvent.getSource) {
                const oSource = oEvent.getSource();
                const bindingInfo = oSource.getBindingInfo("value");
                if (bindingInfo && bindingInfo.parts && bindingInfo.parts[0]) {
                    sChangedField = bindingInfo.parts[0].path || "";
                }
            }

            const aCustomers = oUIModel.getProperty("/F4_DATA/customer") || [];
            const oCustomer = aCustomers.find(c => c.key === oDraft.soldToParty);

            // Only overwrite billing/financial fields from customer master
            // when the Sold-To Party itself was changed
            const bSoldToChanged = sChangedField === "soldToParty" 
                || sChangedField === "/draftModel/soldToParty"
                || sChangedField === "generalInfo/soldToParty"
                || sChangedField === "/draftModel/generalInfo/soldToParty";

            if (oCustomer) {
                // Populate partner details whenever sold-to changes
                if (bSoldToChanged) {
                    const aPartners = oDraft.partners || [];
                    oDraft.partners = aPartners.map(p => {
                        if (p.role !== "AP") {
                            return {
                                role: p.role,
                                desc: p.desc,
                                partnerId: oCustomer.key,
                                name: oCustomer.desc,
                                address: oCustomer.address || ""
                            };
                        }
                        return p;
                    });
                    
                    // Inherit organizational details from customer master only on sold-to change
                    oDraft.paymentTerms = oCustomer.paymentTerms;
                    oDraft.incotermsPart1 = oCustomer.incoterms1;
                    oDraft.incotermsPart2 = oCustomer.incoterms2;

                    if (oDraft.billingFinancial) {
                        oDraft.billingFinancial.paymentTerms = oCustomer.paymentTerms;
                        oDraft.billingFinancial.incotermsPart1 = oCustomer.incoterms1;
                        oDraft.billingFinancial.incotermsPart2 = oCustomer.incoterms2;
                        if (!oDraft.billingFinancial.incotermsLocation) {
                            oDraft.billingFinancial.incotermsLocation = oCustomer.incoterms2;
                        }
                    }
                }
            }

            this.applyCalculationsAndATP();
        },

        /* Pricing Conditions Manual Overrides Management */
        onPricingItemChange(oEvent) {
            const oUIModel = this.getView().getModel("ui");
            const sSelectedItemNum = oEvent.getParameter("selectedItem").getKey();
            const oDraft = oUIModel.getProperty("/draftModel");
            
            const selectedIndex = oDraft.items.findIndex(i => i.itemNum === sSelectedItemNum);
            
            if (selectedIndex !== -1) {
                oUIModel.setProperty("/selectedLineItemIndex", selectedIndex);
                oUIModel.setProperty("/selectedItemNum", sSelectedItemNum);
                
                const curItem = oDraft.items[selectedIndex];
                
                // Just update the conditions table for the selected item, no need to recalculate the whole order
                oUIModel.setProperty("/selectedItemConditions", curItem.conditions || []);
                this._updateSelectedPricingSummary(oUIModel, curItem);
                
                // Reset manual override inputs
                oUIModel.setProperty("/manualPrice", curItem.manualPR00 !== undefined ? curItem.manualPR00 : curItem.price);
                oUIModel.setProperty("/manualDiscount", curItem.manualK007 !== undefined ? curItem.manualK007 : 0.00);
                oUIModel.setProperty("/manualFreight", curItem.manualKF00 !== undefined ? curItem.manualKF00 : 0.00);
            }
        },

        /* Schedule Lines Item Filter Change */
        onScheduleItemChange(oEvent) {
            const oUIModel = this.getView().getModel("ui");
            const sSelectedItemNum = oEvent.getParameter("selectedItem").getKey();
            const oDraft = oUIModel.getProperty("/draftModel");

            oUIModel.setProperty("/selectedScheduleItemNum", sSelectedItemNum);
            const aAllLines = oDraft.scheduleLines || [];
            const aFiltered = aAllLines.filter(sl => sl.itemNum === sSelectedItemNum);
            oUIModel.setProperty("/selectedItemScheduleLines", aFiltered);
        },

        onPricingOverrideChange() {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const selectedIndex = oUIModel.getProperty("/selectedLineItemIndex") || 0;
            const oDraft = oUIModel.getProperty("/draftModel");
            const curItem = oDraft.items[selectedIndex];

            if (curItem) {
                const manualPrice = oUIModel.getProperty("/manualPrice");
                const manualDiscount = oUIModel.getProperty("/manualDiscount");
                const manualFreight = oUIModel.getProperty("/manualFreight");

                curItem.manualPR00 = manualPrice !== "" ? parseFloat(manualPrice) : undefined;
                curItem.manualK007 = manualDiscount !== "" ? parseFloat(manualDiscount) : undefined;
                curItem.manualKF00 = manualFreight !== "" ? parseFloat(manualFreight) : undefined;
            }

            oUIModel.setProperty("/draftIndicator", "Saving");
            setTimeout(() => {
                this.applyCalculationsAndATP();
            }, 800);
        },

        _updateSelectedPricingSummary(oUIModel, curItem) {
            if (curItem) {
                oUIModel.setProperty("/selectedItemQty", curItem.qty || 0);
                
                let netVal = parseFloat(curItem.netValue || 0);
                let taxVal = 0;
                
                if (curItem.conditions && curItem.conditions.length > 0) {
                    // Find tax condition (MWST)
                    const taxCond = curItem.conditions.find(c => c.type === "MWST" || c.type === "TTX1");
                    if (taxCond) {
                        taxVal = parseFloat(taxCond.val) || 0;
                    }
                    
                    // Find the exact final subtotal calculated value for Net
                    const subtotals = curItem.conditions.filter(c => c.type === "—" && c.desc === "Subtotal");
                    if (subtotals.length > 0) {
                        netVal = parseFloat(subtotals[subtotals.length - 1].val) || netVal;
                    }
                }
                
                oUIModel.setProperty("/selectedItemNet", netVal.toFixed(2));
                oUIModel.setProperty("/selectedItemTax", taxVal.toFixed(2));
            } else {
                oUIModel.setProperty("/selectedItemQty", 0);
                oUIModel.setProperty("/selectedItemNet", "0.00");
                oUIModel.setProperty("/selectedItemTax", "0.00");
            }
        },

        /* Update the Schedule Lines table to show only lines for the selected item */
        _updateSelectedScheduleLines(oUIModel, oDraft) {
            const aAllLines = (oDraft && oDraft.scheduleLines) ? oDraft.scheduleLines : [];
            let sSelectedItemNum = oUIModel.getProperty("/selectedScheduleItemNum");

            // Default to first item if nothing selected yet
            if (!sSelectedItemNum && oDraft && oDraft.items && oDraft.items.length > 0) {
                sSelectedItemNum = oDraft.items[0].itemNum;
                oUIModel.setProperty("/selectedScheduleItemNum", sSelectedItemNum);
            }

            if (sSelectedItemNum) {
                const aFiltered = aAllLines.filter(sl => sl.itemNum === sSelectedItemNum);
                oUIModel.setProperty("/selectedItemScheduleLines", aFiltered);
            } else {
                oUIModel.setProperty("/selectedItemScheduleLines", aAllLines);
            }
        },

        /* ================== SAP Error Parser & Message Log ================== */

        /**
         * Parses a raw SAP OData error string (JSON) and extracts the
         * human-readable message. Falls back to the raw string if parsing fails.
         */
        _parseSAPError(sRawError) {
            try {
                const oErr = JSON.parse(sRawError);
                if (oErr && oErr.error && oErr.error.message && oErr.error.message.value) {
                    return oErr.error.message.value;
                }
            } catch (e) {
                // Not valid JSON — try to extract from prefixed string like "Header update failed: {...}"
                const jsonStart = sRawError.indexOf("{");
                if (jsonStart > -1) {
                    try {
                        const oErr = JSON.parse(sRawError.substring(jsonStart));
                        if (oErr && oErr.error && oErr.error.message && oErr.error.message.value) {
                            return oErr.error.message.value;
                        }
                    } catch (e2) { /* ignore */ }
                }
            }
            return sRawError;
        },

        /**
         * Adds a message entry to the persistent message log.
         * @param {string} sType - "Error", "Success", "Warning", "Information"
         * @param {string} sTitle - Short title
         * @param {string} sDetails - Full detail text
         */
        _addMessageLog(sType, sTitle, sDetails) {
            const oUIModel = this.getView().getModel("ui");
            const aLog = oUIModel.getProperty("/messageLog") || [];
            aLog.unshift({
                type: sType,
                title: sTitle,
                details: sDetails || sTitle,
                timestamp: new Date().toLocaleString()
            });
            oUIModel.setProperty("/messageLog", aLog);
        },

        /* Message Log Dialog */
        onShowMessageLog() {
            const oUIModel = this.getView().getModel("ui");
            const aLog = oUIModel.getProperty("/messageLog") || [];

            // Build list items from the log
            const oList = new sap.m.List({ noDataText: "No messages recorded yet." });

            if (aLog.length > 0) {
                aLog.forEach(function (msg) {
                    var sIcon, sHighlight;
                    switch (msg.type) {
                        case "Error":       sIcon = "sap-icon://error"; sHighlight = "Error"; break;
                        case "Success":     sIcon = "sap-icon://sys-enter-2"; sHighlight = "Success"; break;
                        case "Warning":     sIcon = "sap-icon://alert"; sHighlight = "Warning"; break;
                        default:            sIcon = "sap-icon://information"; sHighlight = "Information"; break;
                    }
                    oList.addItem(new sap.m.FeedListItem({
                        icon: sIcon,
                        text: msg.title,
                        info: msg.type,
                        timestamp: msg.timestamp,
                        highlight: sHighlight
                    }));
                });
            }

            const oDialog = new sap.m.Dialog({
                title: "Message Log (" + aLog.length + " entries)",
                contentWidth: "550px",
                contentHeight: "400px",
                verticalScrolling: true,
                content: [oList],
                beginButton: new sap.m.Button({
                    text: "Clear Log",
                    type: "Reject",
                    press: function () {
                        oUIModel.setProperty("/messageLog", []);
                        oDialog.close();
                        MessageToast.show("Message log cleared.");
                    }
                }),
                endButton: new sap.m.Button({
                    text: "Close",
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        /* ================== DYNAMIC VALUE HELP DIALOGS (F4 Suggestions) ================== */
        _fetchAndOpenF4(oEvent, sEntityName, sModelPath, sTitle, sTitleProp = "key", sDescProp = "desc", sInfoProp = "") {
            const oUIModel = this.getView().getModel("ui");
            const aData = oUIModel.getProperty(sModelPath);
            
            // If we already loaded this lookup table, open immediately
            if (aData && aData.length > 0) {
                this._openF4SelectDialog(oEvent, sModelPath, sTitle, sTitleProp, sDescProp, sInfoProp);
                return;
            }

            // Otherwise, fetch dynamically using the OData V4 Model to ensure it uses $batch
            const oModel = this.getView().getModel("valueHelp");
            const oListBinding = oModel.bindList("/" + sEntityName);
            
            // Request an arbitrarily large number to remove any UI caps.
            // This ensures all records are fetched if the backend allows it.
            oListBinding.requestContexts(0, 1000000)
                .then(aContexts => {
                    const aMapped = aContexts.map(oContext => {
                        const item = oContext.getObject();
                        const keys = Object.keys(item).filter(k => !k.startsWith("@") && k !== "SAP__Messages");
                        return {
                            key: item[sEntityName] || item[keys[0]] || "",
                            desc: item[sEntityName + "Name"] || item[keys[1]] || ""
                        };
                    });
                    oUIModel.setProperty(sModelPath, aMapped);
                    this._openF4SelectDialog(oEvent, sModelPath, sTitle, sTitleProp, sDescProp, sInfoProp);
                })
                .catch(err => {
                    sap.m.MessageBox.error("Error loading value help: " + err.message);
                });
        },

        /* Pre-load Delivery Block reason codes from SAP value help OData V4 service */
        _loadDeliveryBlockF4() {
            const oUIModel = this.getView().getModel("ui");
            const aExisting = oUIModel.getProperty("/F4_DATA/deliveryBlock");
            if (aExisting && aExisting.length > 0) {
                return; // Already loaded
            }

            // Fetch delivery blocks from the live API
            fetch("/sap/opu/odata4/sap/zsb_value_helps/srvd_a2x/sap/zsd_value_helps/0001/DeliveryBlock")
                .then(response => {
                    if (!response.ok) {
                        throw new Error("Failed to load delivery blocks from API");
                    }
                    return response.json();
                })
                .then(data => {
                    const aMapped = [{ key: "", desc: "No Block" }];
                    if (data && data.value) {
                        data.value.forEach(item => {
                            aMapped.push({
                                key: item.DeliveryBlockReason,
                                desc: item.DeliveryBlockReasonText
                            });
                        });
                    }
                    oUIModel.setProperty("/F4_DATA/deliveryBlock", aMapped);
                })
                .catch(err => {
                    // Fallback if API fails
                    oUIModel.setProperty("/F4_DATA/deliveryBlock", [
                        { key: "", desc: "No Block" },
                        { key: "01", desc: "Credit block" },
                        { key: "02", desc: "Delivery block (general)" },
                        { key: "03", desc: "Shipping block" }
                    ]);
                });
        },

        /* Pre-load Billing Block reason codes from SAP value help OData V4 service */
        _loadBillingBlockF4() {
            const oUIModel = this.getView().getModel("ui");
            const aExisting = oUIModel.getProperty("/F4_DATA/billingBlock");
            if (aExisting && aExisting.length > 0) {
                return; // Already loaded
            }

            const oModel = this.getView().getModel("valueHelp");
            if (!oModel) {
                // Fallback standard SAP billing blocks
                oUIModel.setProperty("/F4_DATA/billingBlock", [
                    { key: "", desc: "No Block" },
                    { key: "01", desc: "Credit memo" },
                    { key: "02", desc: "Defective" },
                    { key: "03", desc: "Prices incomplete" },
                    { key: "04", desc: "Check terms of payment" },
                    { key: "08", desc: "Check credit memo" },
                    { key: "09", desc: "Check debit memo" }
                ]);
                return;
            }

            const oListBinding = oModel.bindList("/BillingBlock");
            oListBinding.requestContexts(0, 1000000)
                .then(aContexts => {
                    const aMapped = [{ key: "", desc: "No Block" }];
                    aContexts.forEach(oContext => {
                        const item = oContext.getObject();
                        const keys = Object.keys(item).filter(k => !k.startsWith("@") && k !== "SAP__Messages");
                        aMapped.push({
                            key: item.BillingBlock || item[keys[0]] || "",
                            desc: item.BillingBlockName || item[keys[1]] || ""
                        });
                    });
                    oUIModel.setProperty("/F4_DATA/billingBlock", aMapped);
                })
                .catch(() => {
                    oUIModel.setProperty("/F4_DATA/billingBlock", [
                        { key: "", desc: "No Block" },
                        { key: "01", desc: "Credit memo" },
                        { key: "02", desc: "Defective" },
                        { key: "03", desc: "Prices incomplete" },
                        { key: "04", desc: "Check terms of payment" },
                        { key: "08", desc: "Check credit memo" },
                        { key: "09", desc: "Check debit memo" }
                    ]);
                });
        },

        onOrderTypeHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "SalerOrderType", "/F4_DATA/orderType", "Select Sales Order Type");
        },

        onSalesOrgHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "SalesOrgnization", "/F4_DATA/salesOrg", "Select Sales Organization");
        },

        onDistChannelHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "DistributionChannel", "/F4_DATA/distChannel", "Select Distribution Channel");
        },

        onDivisionHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "Division", "/F4_DATA/division", "Select Division");
        },

        onCreateSoldToHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "SoldToParty", "/F4_DATA/customer", "Select Sold-To Customer (KNA1)", "key", "desc", "address");
        },
        onSoldToHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "SoldToParty", "/F4_DATA/customer", "Select Sold-To Customer (KNA1)", "key", "desc", "address");
        },

        onShipToHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "ShipToParty", "/F4_DATA/customer", "Select Ship-To Party (KNA1)", "key", "desc", "address");
        },

        onSalesContractHelp(oEvent) {
            const oInput = oEvent.getSource();
            const oUIModel = this.getView().getModel("ui");
            const oModel = this.getView().getModel("salesContract");
            
            if (!oModel) {
                MessageBox.error("Sales Contract Model not initialized.");
                return;
            }

            const oTemplate = new StandardListItem({
                title: "{salesContract>SalesContract}",
                description: "{salesContract>SoldToParty} - {salesContract>SalesContractType}"
            });

            const oSelectDialog = new SelectDialog({
                title: "Select Sales Contract",
                search: (oSearchEvent) => {
                    const sValue = oSearchEvent.getParameter("value");
                    const oFilter = new Filter([
                        new Filter("SalesContract", FilterOperator.Contains, sValue),
                        new Filter("SoldToParty", FilterOperator.Contains, sValue)
                    ], false);
                    oSearchEvent.getSource().getBinding("items").filter([oFilter]);
                },
                confirm: (oConfirmEvent) => {
                    const oSelectedItem = oConfirmEvent.getParameter("selectedItem");
                    if (oSelectedItem) {
                        const sSelectedKey = oSelectedItem.getTitle();
                        oUIModel.setProperty("/newOrder/salesContract", sSelectedKey);
                    }
                }
            });

            oSelectDialog.setModel(oModel, "salesContract");
            oSelectDialog.bindAggregation("items", {
                path: "salesContract>/A_SalesContract",
                template: oTemplate,
                parameters: {
                    select: "SalesContract,SoldToParty,SalesContractType"
                }
            });

            oSelectDialog.open();
        },

        onCopyFromContract() {
            const oUIModel = this.getView().getModel("ui");
            const newOrderData = oUIModel.getProperty("/newOrder");
            const sContractId = newOrderData.salesContract;

            if (!sContractId) {
                MessageBox.error("Please select a Sales Contract first.");
                return;
            }

            const oModel = this.getView().getModel("salesContract");
            
            sap.ui.core.BusyIndicator.show(0);
            
            const sPath = "/A_SalesContract('" + sContractId + "')";
            
            oModel.read(sPath, {
                urlParameters: {
                    "$expand": "to_Item"
                },
                success: (oData) => {
                    sap.ui.core.BusyIndicator.hide();
                    
                    // Close dialog
                    if (this.pDialog) {
                        this.pDialog.then(function(oDialog) {
                            oDialog.close();
                        });
                    }
                    
                    oUIModel.setProperty("/isCreateByContract", false);

                    // Unselect Master list selection
                    const oList = this.byId("orderList");
                    if (oList) {
                        oList.removeSelections(true);
                    }

                    oUIModel.setProperty("/activeOrder", true);
                    oUIModel.setProperty("/isEditing", true);
                    oUIModel.setProperty("/selectedLineItemIndex", 0);

                    const generatedDraftNo = "Draft-" + Math.floor(1000 + Math.random() * 9000);

                    // Map Header Data
                    const sReqDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                    const sDocDate = new Date().toISOString().split("T")[0];
                    
                    const freshDraft = {
                        salesOrder: generatedDraftNo,
                        orderType: newOrderData.orderType,
                        netValue: 0,
                        docCurrency: oData.TransactionCurrency || "INR",
                        soldToParty: oData.SoldToParty || newOrderData.soldToParty,
                        docDate: sDocDate,
                        shippingPoint: "",
                        poNumber: "",
                        status: "Own Draft",
                        lockedBy: "",
                        salesContract: sContractId,
                        
                        orderCreationInit: {
                            orderType: newOrderData.orderType,
                            salesOrg: oData.SalesOrganization || newOrderData.salesOrg,
                            distChannel: oData.DistributionChannel || newOrderData.distChannel,
                            division: oData.OrganizationDivision || newOrderData.division,
                            soldToParty: oData.SoldToParty || newOrderData.soldToParty
                        },
                        generalInfo: {
                            orderType: newOrderData.orderType,
                            salesOrg: oData.SalesOrganization || newOrderData.salesOrg,
                            distChannel: oData.DistributionChannel || newOrderData.distChannel,
                            division: oData.OrganizationDivision || newOrderData.division,
                            soldToParty: oData.SoldToParty || newOrderData.soldToParty,
                            shipToParty: oData.SoldToParty || newOrderData.soldToParty,
                            poNumber: "",
                            poDate: null,
                            docDate: sDocDate,
                            reqDeliveryDate: sReqDate,
                            salesOffice: "",
                            salesGroup: ""
                        },
                        shippingRoute: {
                            shippingConditions: "",
                            shippingPoint: "",
                            route: "",
                            loadingGroup: ""
                        },
                        billingFinancial: {
                            paymentTerms: oData.CustomerPaymentTerms || "",
                            incotermsPart1: oData.IncotermsClassification || "",
                            incotermsPart2: oData.IncotermsTransferLocation || "",
                            incotermsLocation: oData.IncotermsLocation1 || oData.IncotermsTransferLocation || "",
                            billingBlock: "",
                            deliveryBlock: "",
                            docCurrency: oData.TransactionCurrency || "INR"
                        },
                        items: [],
                        partners: [],
                        pricingConditions: [],
                        scheduleLines: []
                    };
                    
                    // Map Items
                    if (oData.to_Item && oData.to_Item.results && oData.to_Item.results.length > 0) {
                        let currentItemNum = 10;
                        oData.to_Item.results.forEach(contractItem => {
                            let itemQty = 0;
                            if (contractItem.TargetQuantity && parseFloat(contractItem.TargetQuantity) > 0) {
                                itemQty = parseFloat(contractItem.TargetQuantity);
                            } else if (contractItem.RequestedQuantity && parseFloat(contractItem.RequestedQuantity) > 0) {
                                itemQty = parseFloat(contractItem.RequestedQuantity);
                            }
                            
                            freshDraft.items.push({
                                itemNum: currentItemNum.toString(),
                                material: contractItem.Material || "",
                                desc: contractItem.SalesContractItemText || "",
                                qty: itemQty,
                                uom: contractItem.TargetQuantityUnit || contractItem.RequestedQuantityUnit || "",
                                plant: contractItem.ProductionPlant || "",
                                storLoc: contractItem.StorageLocation || "",
                                itemCategory: "",
                                price: 0,
                                netValue: 0,
                                shippingPoint: contractItem.ShippingPoint || ""
                            });
                            currentItemNum += 10;
                        });
                    }
                    
                    oUIModel.setProperty("/draftModel", freshDraft);
                    this.applyCalculationsAndATP();

                    const oSplitApp = this.byId("splitApp");
                    if (oSplitApp) {
                        oSplitApp.toDetail("detailPage");
                    }
                    
                    MessageToast.show("Order Draft created from Contract " + sContractId);
                },
                error: (oError) => {
                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.error("Failed to fetch Sales Contract details.");
                }
            });
        },

        onMaterialHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "Material", "/F4_DATA/material", "Select Material (MARA)", "key", "desc");
        },

        onPlantHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "Plant", "/F4_DATA/plant", "Select Delivering Plant (T001W)", "key", "desc");
        },

        onStorLocHelp(oEvent) {
            this._openF4SelectDialog(oEvent, "/F4_DATA/storageLocation", "Select Storage Location (T001L)", "key", "desc", "");
        },

        onShippingConditionHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "ShippingCondition", "/F4_DATA/shippingCondition", "Select Shipping Condition", "key", "desc");
        },

        onPaymentTermsHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "PaymentTerms", "/F4_DATA/paymentTerms", "Select Payment Terms", "key", "desc");
        },

        onIncotermsClassificationHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "IncotermsClassification", "/F4_DATA/incotermsClassification", "Select Incoterms Classification", "key", "desc");
        },

        _openF4SelectDialog(oEvent, sDataPath, sTitle, sTitleProp, sDescProp, sInfoProp) {
            const oInput = oEvent.getSource();
            const oUIModel = this.getView().getModel("ui");

            // Construct dynamic template for binding
            const oTemplate = new StandardListItem({
                title: "{ui>" + sTitleProp + "}",
                description: "{ui>" + sDescProp + "}"
            });
            if (sInfoProp) {
                oTemplate.bindProperty("info", "ui>" + sInfoProp);
            }

            const oSelectDialog = new SelectDialog({
                title: sTitle,
                search: (oSearchEvent) => {
                    const sValue = oSearchEvent.getParameter("value");
                    const oFilter1 = new Filter(sTitleProp, FilterOperator.Contains, sValue);
                    const oFilter2 = new Filter(sDescProp, FilterOperator.Contains, sValue);
                    const oCombinedFilter = new Filter({
                        filters: [oFilter1, oFilter2],
                        and: false
                    });
                    oSearchEvent.getSource().getBinding("items").filter([oCombinedFilter]);
                },
                confirm: (oConfirmEvent) => {
                    const oSelectedItem = oConfirmEvent.getParameter("selectedItem");
                    if (oSelectedItem) {
                        const sSelectedKey = oSelectedItem.getTitle();
                        
                        // Update the model binding directly so the JSON model is in sync
                        const bindingInfo = oInput.getBindingInfo("value");
                        if (bindingInfo && bindingInfo.parts && bindingInfo.parts[0]) {
                            const sBindingPath = bindingInfo.parts[0].path;
                            const sModelName = bindingInfo.parts[0].model;
                            const oBindingModel = sModelName ? oInput.getModel(sModelName) : oUIModel;
                            
                            // Resolve the full absolute path for the property
                            const oBindingContext = oInput.getBindingContext(sModelName || "ui");
                            let sAbsolutePath;
                            if (sBindingPath.startsWith("/")) {
                                // Already absolute (e.g., /draftModel/billingFinancial/paymentTerms)
                                sAbsolutePath = sBindingPath;
                            } else if (oBindingContext) {
                                // Relative path — resolve against the binding context
                                sAbsolutePath = oBindingContext.getPath() + "/" + sBindingPath;
                            } else {
                                sAbsolutePath = sBindingPath;
                            }
                            
                            oBindingModel.setProperty(sAbsolutePath, sSelectedKey);
                            
                            // Also set the description virtual field
                            oBindingModel.setProperty(sAbsolutePath + "Desc", oSelectedItem.getDescription());
                        } else {
                            // Fallback: set DOM value directly
                            oInput.setValue(sSelectedKey);
                        }

                        oInput.fireChange(); // Trigger calculations
                    }
                }
            });

            // Bind the data model to the dialog natively instead of mapping statically
            oSelectDialog.setModel(oUIModel, "ui");
            oSelectDialog.bindAggregation("items", {
                path: "ui>" + sDataPath,
                template: oTemplate
            });

            oSelectDialog.open();
        },

        /* Simulate Order - Calls SAP Simulation API for pricing conditions and schedule lines */
        onSimulateOrder() {
            const oUIModel = this.getView().getModel("ui");
            const oDraft = oUIModel.getProperty("/draftModel");
            if (!oDraft) {
                MessageBox.error("No active order to simulate.");
                return;
            }

            if (!oDraft.items || oDraft.items.length === 0) {
                MessageBox.error("Cannot simulate: Please add at least one line item first.");
                return;
            }

            // Validate items have material and quantity
            let bHasInvalidItem = false;
            oDraft.items.forEach(item => {
                if (!item.material || parseFloat(item.qty) <= 0) {
                    bHasInvalidItem = true;
                }
            });
            if (bHasInvalidItem) {
                MessageBox.error("Simulation requires all items to have a material and quantity greater than 0.");
                return;
            }

            // Build the simulation payload matching SAP API_SALES_ORDER_SIMULATION_SRV format
            const sSimulationPayload = {
                "SalesOrderType": oDraft.orderType || (oDraft.orderCreationInit ? oDraft.orderCreationInit.orderType : ""),
                "SalesOrganization": (oDraft.generalInfo ? oDraft.generalInfo.salesOrg : "") || "",
                "DistributionChannel": (oDraft.generalInfo ? oDraft.generalInfo.distChannel : "") || "",
                "OrganizationDivision": (oDraft.generalInfo ? oDraft.generalInfo.division : "") || "",
                "SoldToParty": oDraft.soldToParty || "",
                "PurchaseOrderByCustomer": oDraft.poNumber || "Simulated via OData API",
                "CustomerPaymentTerms": (oDraft.billingFinancial ? oDraft.billingFinancial.paymentTerms : "") || "",
                "ShippingCondition": (oDraft.shippingRoute ? oDraft.shippingRoute.shippingConditions : "") || "",
                "to_Item": [],
                "to_Pricing": {},
                "to_Partner": [],
                "to_Credit": {}
            };

            // Map line items for simulation
            oDraft.items.forEach(item => {
                const oSimItem = {
                    "SalesOrderItem": item.itemNum,
                    "HigherLevelItem": "0",
                    "SalesOrderItemCategory": item.itemCategory || "TAN",
                    "PurchaseOrderByCustomer": "Simulated via OData API",
                    "Material": item.material,
                    "RequestedQuantity": item.qty ? item.qty.toString() + ".000" : "0.000",
                    "DeliveryPriority": "2",
                    "Plant": item.plant || "",
                    "to_ScheduleLine": [],
                    "to_Partner": [
                        {
                            "PartnerFunction": "SH",
                            "Customer": oDraft.soldToParty || ""
                        }
                    ],
                    "to_PricingElement": []
                };
                sSimulationPayload.to_Item.push(oSimItem);
            });

            // Map header-level partners
            if (oDraft.partners && oDraft.partners.length > 0) {
                sSimulationPayload.to_Partner = oDraft.partners.map(p => ({
                    "PartnerFunction": p.role,
                    "Customer": p.partnerId
                }));
            }

            const sSimServiceUrl = "/sap/opu/odata/sap/API_SALES_ORDER_SIMULATION_SRV/";

            sap.ui.core.BusyIndicator.show(0);

            // Step 1: Fetch CSRF token from simulation service
            fetch(sSimServiceUrl, {
                method: "GET",
                headers: {
                    "X-CSRF-Token": "Fetch",
                    "Accept": "application/json"
                }
            })
            .then(response => {
                const sCsrfToken = response.headers.get("X-CSRF-Token");
                if (!sCsrfToken) {
                    throw new Error("Could not retrieve CSRF token from SAP Simulation Service.");
                }

                // Step 2: POST simulation payload
                return fetch(sSimServiceUrl + "A_SalesOrderSimulation", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "X-CSRF-Token": sCsrfToken
                    },
                    body: JSON.stringify(sSimulationPayload)
                });
            })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => { throw new Error(text); });
                }
                return response.json();
            })
            .then(data => {
                sap.ui.core.BusyIndicator.hide();
                const oResult = data.d || data;

                // Log the full SAP response to the console so the user can inspect it
                console.log("=== SAP Simulation Response ===", oResult);

                // Parse simulation results and update draft model
                this._processSimulationResponse(oResult, oDraft, oUIModel);

                this._addMessageLog("Success", "Sales Order simulation completed successfully. Pricing conditions and schedule lines updated from SAP.");
                MessageToast.show("Simulation complete! Pricing & Schedule Lines updated from SAP.");
            })
            .catch(error => {
                sap.ui.core.BusyIndicator.hide();
                const sCleanMsg = this._parseSAPError(error.message);
                this._addMessageLog("Error", "Simulation failed: " + sCleanMsg, error.message);
                MessageBox.error("Simulation Failed: " + sCleanMsg, {
                    title: "SAP Simulation Error",
                    actions: [MessageBox.Action.CLOSE]
                });
            });
        },

        /* Process SAP Simulation Response - Extract pricing conditions and schedule lines */
        _processSimulationResponse(oResult, oDraft, oUIModel) {
            // Extract items from simulation response
            const aSimItems = (oResult.to_Item && oResult.to_Item.results) 
                ? oResult.to_Item.results 
                : (oResult.to_Item || []);

            // Map simulation results back to draft items
            aSimItems.forEach(simItem => {
                const sItemNum = simItem.SalesOrderItem;
                const oDraftItem = oDraft.items.find(i => i.itemNum === sItemNum);
                if (!oDraftItem) return;

                // Update item-level fields from simulation
                if (simItem.SalesOrderItemText) oDraftItem.desc = simItem.SalesOrderItemText;
                if (simItem.NetAmount !== undefined) oDraftItem.netValue = parseFloat(simItem.NetAmount) || 0;
                if (simItem.Plant) oDraftItem.plant = simItem.Plant;
                if (simItem.ShippingPoint) oDraftItem.shippingPoint = simItem.ShippingPoint;
                if (simItem.RequestedQuantityUnit) oDraftItem.uom = simItem.RequestedQuantityUnit;
                if (simItem.SalesOrderItemCategory) oDraftItem.itemCategory = simItem.SalesOrderItemCategory;

                // Extract Pricing Elements (to_PricingElement)
                const aPricingElements = (simItem.to_PricingElement && simItem.to_PricingElement.results)
                    ? simItem.to_PricingElement.results
                    : (simItem.to_PricingElement || []);

                if (aPricingElements.length > 0) {
                    oDraftItem.conditions = aPricingElements.map(pe => ({
                        step: pe.PricingProcedureStep || "",
                        itemNum: pe.SalesOrderItem || simItem.SalesOrderItem || "",
                        type: pe.ConditionType || "—",
                        desc: this._getConditionDescription(pe.ConditionType),
                        rate: pe.ConditionRateValue !== undefined 
                            ? (pe.ConditionCalculationType === "A" 
                                ? parseFloat(pe.ConditionRateValue).toFixed(2) + "%" 
                                : parseFloat(pe.ConditionRateValue).toFixed(2))
                            : "—",
                        base: pe.ConditionBaseValue !== undefined 
                            ? parseFloat(pe.ConditionBaseValue).toFixed(2) 
                            : "—",
                        val: pe.ConditionAmount !== undefined 
                            ? parseFloat(pe.ConditionAmount).toFixed(2) 
                            : "0.00"
                    }));
                    
                    // Derive item net value directly from the final subtotal in pricing conditions
                    const subtotals = oDraftItem.conditions.filter(c => c.type === "—" && (c.desc === "Subtotal" || c.desc === "Net Value (Total Net)"));
                    if (subtotals.length > 0) {
                        oDraftItem.netValue = parseFloat(subtotals[subtotals.length - 1].val) || 0;
                    }
                }

                // Extract Schedule Lines (to_ScheduleLine)
                const aScheduleLines = (simItem.to_ScheduleLine && simItem.to_ScheduleLine.results)
                    ? simItem.to_ScheduleLine.results
                    : (simItem.to_ScheduleLine || []);

                // Store schedule lines at item level for later aggregation
                oDraftItem._simulatedScheduleLines = aScheduleLines;
            });

            // Map all schedule lines across items into the draft's scheduleLines array
            // ATP Logic: If full qty is confirmed on the requested date → single line.
            // Otherwise, keep confirmed portion and create additional lines for unconfirmed balance.
            const aAllScheduleLines = [];
            oDraft.items.forEach(item => {
                const aItemSchedLines = item._simulatedScheduleLines || [];
                
                // Log the raw SAP schedule lines for debugging
                console.log(`=== SAP Schedule Lines Data for Item ${item.itemNum} ===`, aItemSchedLines);

                if (aItemSchedLines.length === 0) return;

                // Aggregate totals from SAP response
                let nTotalOrdered = 0;
                let nTotalConfirmed = 0;

                aItemSchedLines.forEach(sl => {
                    nTotalOrdered += parseFloat(sl.ScheduleLineOrderQuantity) || 0;
                    nTotalConfirmed += parseFloat(sl.ConfdOrderQtyByMatlAvailCheck) || 0;
                });

                // Helper: parse SAP date string to a display date (yyyy-MM-dd)
                const fnParseDate = (rawDate) => {
                    if (!rawDate) return "";
                    if (typeof rawDate === "string" && rawDate.indexOf("/Date(") > -1) {
                        const ts = parseInt(rawDate.replace("/Date(", "").replace(")/", ""), 10);
                        return new Date(ts).toISOString().split("T")[0];
                    } else if (typeof rawDate === "string" && rawDate.indexOf("T") > -1) {
                        return rawDate.split("T")[0];
                    }
                    return rawDate;
                };

                // Get the primary requested delivery date from the first SAP schedule line
                const sPrimaryDate = fnParseDate(
                    aItemSchedLines[0].ConfirmedDeliveryDate || aItemSchedLines[0].RequestedDeliveryDate
                );

                // Get UOM from SAP response
                const sUom = aItemSchedLines[0].OrderQuantityUnit || item.uom || "";

                if (nTotalConfirmed >= nTotalOrdered && nTotalOrdered > 0) {
                    // CASE 1: Full quantity is confirmed → single schedule line
                    aAllScheduleLines.push({
                        itemNum: item.itemNum,
                        line: "0001",
                        date: sPrimaryDate,
                        cat: aItemSchedLines[0].ScheduleLineCategory || "CP",
                        orderQty: nTotalOrdered,
                        confQty: nTotalOrdered,
                        uom: sUom,
                        deliveryBlock: "",
                        movType: "601"
                    });
                } else {
                    // CASE 2: Partial or zero confirmation → create lines for confirmed + unconfirmed balance
                    let nLineCounter = 1;

                    // First, map the SAP-returned schedule lines (these show confirmed portions per date)
                    aItemSchedLines.forEach(sl => {
                        const nSlOrdered = parseFloat(sl.ScheduleLineOrderQuantity) || 0;
                        const nSlConfirmed = parseFloat(sl.ConfdOrderQtyByMatlAvailCheck) || 0;
                        const sDate = fnParseDate(sl.ConfirmedDeliveryDate || sl.RequestedDeliveryDate);

                        aAllScheduleLines.push({
                            itemNum: item.itemNum,
                            line: String(nLineCounter).padStart(4, "0"),
                            date: sDate,
                            cat: sl.ScheduleLineCategory || "CP",
                            orderQty: nSlOrdered,
                            confQty: nSlConfirmed,
                            uom: sl.OrderQuantityUnit || sUom,
                            deliveryBlock: sl.ScheduleLineDeliveryBlock || "",
                            movType: sl.GoodsMovementType || "601"
                        });
                        nLineCounter++;
                    });

                    // Calculate unconfirmed balance
                    const nUnconfirmedBalance = nTotalOrdered - nTotalConfirmed;

                    if (nUnconfirmedBalance > 0) {
                        // Create additional schedule line(s) for the unconfirmed balance
                        // Use next available delivery date (requested date + 7 days per split)
                        const oBaseDate = sPrimaryDate ? new Date(sPrimaryDate) : new Date();
                        const nSplitSize = nUnconfirmedBalance; // Single split for full balance
                        let nRemaining = nUnconfirmedBalance;
                        let nDateOffset = 7; // Days to add for next available date

                        while (nRemaining > 0) {
                            const nSplitQty = Math.min(nRemaining, nSplitSize);
                            const oNextDate = new Date(oBaseDate);
                            oNextDate.setDate(oNextDate.getDate() + nDateOffset);
                            const sNextDate = oNextDate.toISOString().split("T")[0];

                            aAllScheduleLines.push({
                                itemNum: item.itemNum,
                                line: String(nLineCounter).padStart(4, "0"),
                                date: sNextDate,
                                cat: "CP",
                                orderQty: 0,
                                confQty: nSplitQty,
                                uom: sUom,
                                deliveryBlock: "",
                                movType: "601"
                            });

                            nRemaining -= nSplitQty;
                            nLineCounter++;
                            nDateOffset += 7; // Next split +7 more days
                        }
                    }
                }

                // Clean up temporary field
                delete item._simulatedScheduleLines;
            });

            // Update schedule lines in draft
            if (aAllScheduleLines.length > 0) {
                oDraft.scheduleLines = aAllScheduleLines;
            }

            // Aggregate all pricing conditions across items into the draft's pricingConditions array
            const aAllPricingConditions = [];
            oDraft.items.forEach(item => {
                if (item.conditions && item.conditions.length > 0) {
                    // Optionally attach itemNum if user wants to map it later, but we just push the conditions
                    item.conditions.forEach(cond => {
                        aAllPricingConditions.push({
                            ...cond,
                            itemNum: item.itemNum // Just in case we add it to the schema later
                        });
                    });
                }
            });
            
            if (aAllPricingConditions.length > 0) {
                oDraft.pricingConditions = aAllPricingConditions;
            }

            // Update overall header net amount from simulation pricing
            if (oResult.to_Pricing) {
                const oPricing = oResult.to_Pricing.d || oResult.to_Pricing;
                
                // Recalculate total document net value by summing the item net values 
                // (which were updated to the final Gross subtotal during item mapping)
                let nTotalDocNet = 0;
                oDraft.items.forEach(item => {
                    nTotalDocNet += (parseFloat(item.netValue) || 0);
                });
                
                if (nTotalDocNet > 0) {
                    oDraft.netValue = nTotalDocNet;
                } else if (oPricing.TotalNetAmount !== undefined) {
                    oDraft.netValue = parseFloat(oPricing.TotalNetAmount) || 0;
                }
            }

            // Update Shipping & Route fields from simulation header
            if (oResult.ShippingCondition !== undefined) {
                oDraft.shippingRoute = oDraft.shippingRoute || {};
                oDraft.shippingRoute.shippingConditions = oResult.ShippingCondition || "";
            }
            if (oResult.ShippingType !== undefined) {
                oDraft.shippingRoute = oDraft.shippingRoute || {};
                oDraft.shippingRoute.shippingType = oResult.ShippingType || "";
            }

            // Update Billing & Financial fields from simulation header
            oDraft.billingFinancial = oDraft.billingFinancial || {};
            if (oResult.IncotermsClassification !== undefined) {
                oDraft.billingFinancial.incotermsPart1 = oResult.IncotermsClassification || "";
            }
            if (oResult.IncotermsTransferLocation !== undefined) {
                oDraft.billingFinancial.incotermsPart2 = oResult.IncotermsTransferLocation || "";
            }
            if (oResult.IncotermsLocation1 !== undefined) {
                oDraft.billingFinancial.incotermsLocation = oResult.IncotermsLocation1 || "";
            }

            // Update Payment Terms from first item (SAP returns it at item level)
            if (aSimItems.length > 0 && aSimItems[0].CustomerPaymentTerms) {
                oDraft.billingFinancial.paymentTerms = aSimItems[0].CustomerPaymentTerms;
            }

            // Update the first item's shipping point and plant as the header
            if (oDraft.items.length > 0) {
                if (oDraft.items[0].shippingPoint) {
                    oDraft.shippingPoint = oDraft.items[0].shippingPoint;
                }
                if (oDraft.items[0].plant) {
                    oDraft.plant = oDraft.items[0].plant;
                }
            }

            // Update Route from simulation header (if available)
            if (oResult.Route !== undefined) {
                oDraft.shippingRoute = oDraft.shippingRoute || {};
                oDraft.shippingRoute.route = oResult.Route || "";
            }

            // Extract Partner Functions from SAP simulation response (to_Partner at header level)
            const aSimPartners = (oResult.to_Partner && oResult.to_Partner.results)
                ? oResult.to_Partner.results
                : (oResult.to_Partner || []);

            if (aSimPartners.length > 0) {
                // Map SAP PartnerFunction codes to human-readable descriptions
                const mPartnerDesc = {
                    "SP": "Sold-to Party",
                    "SH": "Ship-to Party",
                    "BP": "Bill-to Party",
                    "PY": "Payer Party",
                    "AP": "Contact Person",
                    "RE": "Bill-to Party",
                    "RG": "Payer",
                    "AG": "Sold-to Party",
                    "WE": "Ship-to Party",
                    "VE": "Sales Employee",
                    "ER": "Employee Responsible"
                };

                oDraft.partners = aSimPartners.map(p => {
                    const sCustomerId = p.Customer || "";
                    return {
                        role: p.PartnerFunction || "",
                        desc: mPartnerDesc[p.PartnerFunction] || p.PartnerFunction || "",
                        partnerId: sCustomerId
                    };
                });
            }

            // Set the updated draft model
            oUIModel.setProperty("/draftModel", oDraft);

            // Update the selected item conditions display
            const selectedIndex = oUIModel.getProperty("/selectedLineItemIndex") || 0;
            if (oDraft.items[selectedIndex] && oDraft.items[selectedIndex].conditions) {
                oUIModel.setProperty("/selectedItemConditions", oDraft.items[selectedIndex].conditions);
                this._updateSelectedPricingSummary(oUIModel, oDraft.items[selectedIndex]);
            }

            // Update schedule lines filtered by selected item
            this._updateSelectedScheduleLines(oUIModel, oDraft);

            oUIModel.updateBindings(true);
        },

        /* Helper: Map SAP condition type codes to human-readable descriptions */
        _getConditionDescription(sConditionType) {
            const mDescriptions = {
                "PR00": "Base Price",
                "K004": "Material Discount",
                "K005": "Customer/Material Discount",
                "K007": "Customer Discount",
                "KF00": "Freight Surcharge",
                "MWST": "Output Tax",
                "RC00": "Quantity Discount",
                "SKTO": "Cash Discount",
                "RA01": "Discount % on Net",
                "RB00": "Discount (Absolute)",
                "VPRS": "Internal Price (VPRS)",
                "EK01": "Actual Costs",
                "EK02": "Calculated Costs",
                "HA00": "Percentage Surcharge",
                "HB00": "Absolute Surcharge",
                "HD00": "Header Discount"
            };
            return mDescriptions[sConditionType] || (sConditionType ? "Condition " + sConditionType : "Subtotal");
        },

        onSendToSAP() {
            const oUIModel = this.getView().getModel("ui");
            const oDraft = oUIModel.getProperty("/draftModel");
            if (!oDraft) {
                MessageBox.error("No active order to send to SAP.");
                return;
            }

            // Resolve IncotermsLocation1: prefer dedicated field, fall back to incotermsPart2
            const sIncotermsLocation1 = (oDraft.billingFinancial
                ? (oDraft.billingFinancial.incotermsLocation || oDraft.billingFinancial.incotermsPart2 || "")
                : "");

            // Resolve IncotermsClassification
            const sIncotermsClassification = oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart1 : "";

            // Pre-flight: SAP requires IncotermsLocation1 whenever IncotermsClassification is set
            if (sIncotermsClassification && !sIncotermsLocation1) {
                MessageBox.error("Pre-flight check failed: Incoterm Location 1 is required when Incoterms Classification is set.\n\nPlease go to the Billing & Financial tab and fill in the 'Incoterms Location 1' field.");
                return;
            }

            const payload = {
                "SalesOrderType": oDraft.orderType || "",
                "SalesOrganization": oDraft.salesOrg || (oDraft.generalInfo ? oDraft.generalInfo.salesOrg : ""),
                "DistributionChannel": oDraft.distChannel || (oDraft.generalInfo ? oDraft.generalInfo.distChannel : ""),
                "OrganizationDivision": oDraft.division || (oDraft.generalInfo ? oDraft.generalInfo.division : ""),
                "SoldToParty": oDraft.soldToParty || (oDraft.generalInfo ? oDraft.generalInfo.soldToParty : ""),
                "PurchaseOrderByCustomer": oDraft.poNumber || (oDraft.generalInfo ? oDraft.generalInfo.custRef : ""),
                "TransactionCurrency": oDraft.billingFinancial && oDraft.billingFinancial.docCurrency ? oDraft.billingFinancial.docCurrency : "INR",
                "ShippingCondition": oDraft.shippingRoute && oDraft.shippingRoute.shippingConditions ? oDraft.shippingRoute.shippingConditions : "",
                "IncotermsClassification": sIncotermsClassification,
                "IncotermsTransferLocation": oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart2 : "",
                "IncotermsLocation1": sIncotermsLocation1,
                "CustomerPriceGroup": "01",
                "CustomerPaymentTerms": oDraft.billingFinancial ? oDraft.billingFinancial.paymentTerms : "",
                "CustomerAccountAssignmentGroup": "01",
                "to_Partner": [],
                "to_Item": []
            };

            // Map Delivery Date if it exists
            // UI binds to generalInfo.reqDeliveryDate for the DatePicker
            const rawDelDate = oDraft.reqDeliveryDate || (oDraft.generalInfo ? oDraft.generalInfo.reqDeliveryDate : null) || (oDraft.generalInfo ? oDraft.generalInfo.reqDelDate : null);
            if (rawDelDate) {
                const d = new Date(rawDelDate);
                // Use UTC to prevent timezone offsets from shifting the date backwards or forwards
                const utcTimestamp = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
                payload.RequestedDeliveryDate = "/Date(" + utcTimestamp + ")/";
            }

            // Map Partners
            if (oDraft.partners && oDraft.partners.length > 0) {
                payload.to_Partner = oDraft.partners.map(p => ({
                    "PartnerFunction": p.role,
                    "Customer": p.partnerId
                }));
            }

            // Map Items
            if (oDraft.items && oDraft.items.length > 0) {
                payload.to_Item = oDraft.items.map(item => {
                    const oItemPayload = {
                        "Material": item.material,
                        "RequestedQuantity": item.qty ? item.qty.toString() : "0",
                        "RequestedQuantityUnit": item.uom,
                        "ProductionPlant": item.plant,
                        "StorageLocation": item.storLoc || "",
                        "IncotermsClassification": payload.IncotermsClassification,
                        "TransactionCurrency": payload.TransactionCurrency,
                        "NetAmount": item.netValue ? item.netValue.toString() : "0.00",
                        "IncotermsTransferLocation": payload.IncotermsTransferLocation,
                        "IncotermsLocation1": sIncotermsLocation1,
                        "ProductTaxClassification1": "1",
                        "ProductTaxClassification2": "1",
                        "ProductTaxClassification3": "1",
                        "ProductTaxClassification4": "1",
                        "CustomerPaymentTerms": payload.CustomerPaymentTerms
                    };
                    // Only include ShippingPoint if explicitly set, otherwise let SAP determine it
                    if (item.shippingPoint) {
                        oItemPayload.ShippingPoint = item.shippingPoint;
                    }
                    return oItemPayload;
                });
            }

            var sServiceUrl = "/sap/opu/odata/sap/API_SALES_ORDER_SRV/";

            sap.ui.core.BusyIndicator.show(0);

            // Step 1: Fetch CSRF token
            fetch(sServiceUrl, {
                method: "GET",
                headers: {
                    "X-CSRF-Token": "Fetch",
                    "Accept": "application/json"
                }
            })
            .then(response => {
                var sCsrfToken = response.headers.get("X-CSRF-Token");
                if (!sCsrfToken) {
                    throw new Error("Could not retrieve CSRF token from SAP backend.");
                }
                
                const isUpdate = !!oDraft.sapOrderId;
                
                if (isUpdate) {
                    // --- UPDATE MODE (PATCH) ---
                    // S/4HANA requires separate PATCH calls for Header and Items in OData V2
                    const headerUpdate = Object.assign({}, payload);
                    delete headerUpdate.to_Item;
                    delete headerUpdate.to_Partner;
                    delete headerUpdate.SalesOrderType;
                    delete headerUpdate.SalesOrganization;
                    delete headerUpdate.DistributionChannel;
                    delete headerUpdate.OrganizationDivision;
                    // Remove ShippingCondition from header PATCH if empty, to avoid
                    // re-triggering SAP shipping point determination with invalid data
                    if (!headerUpdate.ShippingCondition) {
                        delete headerUpdate.ShippingCondition;
                    }
                    
                    // 1. Update Header
                    let updatePromise = fetch(`${sServiceUrl}A_SalesOrder('${oDraft.sapOrderId}')`, {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                            "X-CSRF-Token": sCsrfToken,
                            "If-Match": "*"
                        },
                        body: JSON.stringify(headerUpdate)
                    }).then(res => {
                        if (!res.ok) return res.text().then(text => { throw new Error("Header update failed: " + text); });
                    });
                    
                    // 2. Update Items sequentially (Upsert Pattern)
                    if (oDraft.items && oDraft.items.length > 0) {
                        oDraft.items.forEach((item, index) => {
                            const fullItemPayload = Object.assign({}, payload.to_Item[index]);
                            
                            // Build the complete item PATCH payload with all editable fields
                            const patchItemPayload = {
                                "Material": item.material || "",
                                "RequestedQuantity": item.qty ? item.qty.toString() : "0",
                                "RequestedQuantityUnit": item.uom || "EA",
                                "ProductionPlant": item.plant || "",
                                "StorageLocation": item.storLoc || "",
                                "ShippingPoint": item.shippingPoint || "",
                                "IncotermsClassification": oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart1 : "",
                                "TransactionCurrency": oDraft.billingFinancial && oDraft.billingFinancial.docCurrency ? oDraft.billingFinancial.docCurrency : "INR",
                                "NetAmount": item.netValue ? item.netValue.toString() : "0.00",
                                "IncotermsTransferLocation": oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart2 : "",
                                "IncotermsLocation1": sIncotermsLocation1,
                                "ProductTaxClassification1": "1",
                                "ProductTaxClassification2": "1",
                                "ProductTaxClassification3": "1",
                                "ProductTaxClassification4": "1",
                                "CustomerPaymentTerms": oDraft.billingFinancial ? oDraft.billingFinancial.paymentTerms : ""
                            };
                            // Remove ShippingPoint from item PATCH if empty, to let SAP
                            // auto-determine it instead of sending an invalid blank value
                            if (!patchItemPayload.ShippingPoint) {
                                delete patchItemPayload.ShippingPoint;
                            }
                            
                            const fnCreateItem = () => {
                                const createPayload = Object.assign({
                                    SalesOrder: oDraft.sapOrderId,
                                    SalesOrderItem: item.itemNum
                                }, fullItemPayload);
                                
                                return fetch(`${sServiceUrl}A_SalesOrder('${oDraft.sapOrderId}')/to_Item`, {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "Accept": "application/json",
                                        "X-CSRF-Token": sCsrfToken
                                    },
                                    body: JSON.stringify(createPayload)
                                }).then(postRes => {
                                    if (!postRes.ok) return postRes.text().then(text => { throw new Error(`Failed to create new Item ${item.itemNum} in SAP: ` + text); });
                                    item.isNewToSAP = false; // Clear flag on success
                                });
                            };

                            if (item.isNewToSAP) {
                                // Direct POST for newly added rows to avoid 404 errors in the console
                                updatePromise = updatePromise.then(() => fnCreateItem());
                            } else {
                                // PATCH existing items, fallback to POST if SAP returns 404 (e.g. added in a previous session)
                                updatePromise = updatePromise.then(() => fetch(`${sServiceUrl}A_SalesOrderItem(SalesOrder='${oDraft.sapOrderId}',SalesOrderItem='${item.itemNum}')`, {
                                    method: "PATCH",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "Accept": "application/json",
                                        "X-CSRF-Token": sCsrfToken,
                                        "If-Match": "*"
                                    },
                                    body: JSON.stringify(patchItemPayload)
                                })).then(res => {
                                    if (res.status === 404) {
                                        return fnCreateItem();
                                    } else if (!res.ok) {
                                        return res.text().then(text => { throw new Error(`Item ${item.itemNum} update failed in SAP: ` + text); });
                                    }
                                });
                            }
                        });
                    }
                    
                    // 3. Delete items that were removed from the UI
                    const aDeletedSAPItems = oUIModel.getProperty("/deletedSAPItems") || [];
                    if (aDeletedSAPItems.length > 0) {
                        aDeletedSAPItems.forEach(deleted => {
                            updatePromise = updatePromise.then(() => 
                                fetch(`${sServiceUrl}A_SalesOrderItem(SalesOrder='${deleted.sapOrderId}',SalesOrderItem='${deleted.itemNum}')`, {
                                    method: "DELETE",
                                    headers: {
                                        "Accept": "application/json",
                                        "X-CSRF-Token": sCsrfToken,
                                        "If-Match": "*"
                                    }
                                }).then(res => {
                                    if (!res.ok && res.status !== 404) {
                                        return res.text().then(text => { throw new Error(`Failed to delete Item ${deleted.itemNum} from SAP: ` + text); });
                                    }
                                })
                            );
                        });
                        // Clear the tracker after sending deletes
                        oUIModel.setProperty("/deletedSAPItems", []);
                    }
                    
                    // Return a mocked response format so the next .then() block can process it like a POST response
                    return updatePromise.then(() => {
                        return { d: { SalesOrder: oDraft.sapOrderId } };
                    });
                    
                } else {
                    // --- CREATE MODE (POST) ---
                    return fetch(sServiceUrl + "A_SalesOrder", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                            "X-CSRF-Token": sCsrfToken
                        },
                        body: JSON.stringify(payload)
                    }).then(res => {
                        if (!res.ok) return res.text().then(text => { throw new Error(text); });
                        return res.json();
                    });
                }
            })
            .then(data => {
                sap.ui.core.BusyIndicator.hide();
                var oResult = data.d || data;
                var orderId = oResult.SalesOrder || oResult.ID || "Unknown ID";

                const oUIModel = this.getView().getModel("ui");
                const wasUpdate = !!oUIModel.getProperty("/draftModel/sapOrderId");
                oUIModel.setProperty("/draftModel/sapOrderId", orderId);

                if (!wasUpdate) {
                    // Auto-save the CAPM draft to persist the new SAP Order ID
                    this.onSaveOrder();
                }

                const sSuccessMsg = wasUpdate 
                    ? "Order changes have been successfully saved to SAP!" 
                    : "Order has been created with this order id: " + orderId;
                this._addMessageLog("Success", sSuccessMsg);

                MessageBox.success(sSuccessMsg, {
                    title: "Success",
                    actions: [MessageBox.Action.CLOSE]
                });
            })
            .catch(error => {
                sap.ui.core.BusyIndicator.hide();
                const sCleanMsg = this._parseSAPError(error.message);
                this._addMessageLog("Error", sCleanMsg, error.message);

                // Build a client-friendly breakdown of the values that were sent
                const sSoldTo = oDraft.soldToParty || "(empty)";
                const sShipTo = (oDraft.generalInfo ? oDraft.generalInfo.shipToParty : "") || "(empty)";
                const sSalesOrg = (oDraft.generalInfo ? oDraft.generalInfo.salesOrg : oDraft.salesOrg) || "(empty)";
                const sDistCh = (oDraft.generalInfo ? oDraft.generalInfo.distChannel : oDraft.distChannel) || "(empty)";
                const sDiv = (oDraft.generalInfo ? oDraft.generalInfo.division : oDraft.division) || "(empty)";
                const sShipCond = (oDraft.shippingRoute ? oDraft.shippingRoute.shippingConditions : "") || "(empty)";
                const sPayTerms = (oDraft.billingFinancial ? oDraft.billingFinancial.paymentTerms : "") || "(empty)";
                const sInco1 = (oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart1 : "") || "(empty)";
                const sInco2 = (oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart2 : "") || "(empty)";

                // Collect material and plant from all line items
                let sItemDetails = "";
                if (oDraft.items && oDraft.items.length > 0) {
                    oDraft.items.forEach(function (item) {
                        sItemDetails += "\n  Item " + item.itemNum + ":  Material = " + (item.material || "(empty)") + 
                                        ",  Plant = " + (item.plant || "(empty)");
                    });
                } else {
                    sItemDetails = "\n  (no items)";
                }

                const sDetailText = 
                    "Below are the values sent to SAP. Please verify they are correct and maintained in the system:\n\n" +
                    "── Header ──\n" +
                    "• Sold-To Party:                    " + sSoldTo + "\n" +
                    "• Ship-To Party (WE):            " + sShipTo + "\n" +
                    "• Sales Organization:             " + sSalesOrg + "\n" +
                    "• Distribution Channel:           " + sDistCh + "\n" +
                    "• Division:                               " + sDiv + "\n" +
                    "• Shipping Conditions:            " + sShipCond + "\n" +
                    "• Payment Terms:                   " + sPayTerms + "\n" +
                    "• Incoterms Part 1:                 " + sInco1 + "\n" +
                    "• Incoterms Part 2 (Transfer): " + sInco2 + "\n\n" +
                    "── Line Items ──" + sItemDetails;

                MessageBox.error(sCleanMsg, {
                    title: "SAP Error",
                    details: sDetailText,
                    actions: [MessageBox.Action.CLOSE],
                    styleClass: "sapUiSizeCompact"
                });
            });
        }

    });
});
