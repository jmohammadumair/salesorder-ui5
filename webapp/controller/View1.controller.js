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
                        storageLocation: []
                    },
                    draftModel: null,
                    newOrder: null,
                    activeOrder: false,
                    isEditing: false,
                    selectedLineItemIndex: 0,
                    manualPrice: 0,
                    manualDiscount: 0,
                    manualFreight: 0,
                    draftIndicator: "",
                    selectedItemConditions: [],
                    simulatedLockUser: ""
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
        },

        /* Handle Back-Navigation in SplitApp on mobile viewports */
        onNavBack() {
            const oSplitApp = this.byId("splitApp");
            if (oSplitApp) {
                oSplitApp.toMaster("masterPage");
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
                const itemNetValue = grossVal + kf00Val;
                
                nTotalDocNet += itemNetValue;
                item.netValue = itemNetValue;
                
                // Build condition rows matching Fiori pricing layout
                item.conditions = [
                    { "step": "11", "type": "PR00", "desc": "Base Price", "rate": pr00Rate.toFixed(2), "base": pr00Val.toFixed(2), "val": pr00Val.toFixed(2) },
                    { "step": "101", "type": "K004", "desc": "Material Discount (-5%)", "rate": k004Rate.toFixed(2) + "%", "base": pr00Val.toFixed(2), "val": k004Val.toFixed(2) },
                    { "step": "105", "type": "K007", "desc": "Customer Discount", "rate": k007Rate.toFixed(2) + "%", "base": pr00Val.toFixed(2), "val": k007Val.toFixed(2) },
                    { "step": "300", "type": "—", "desc": "Gross Value (Subtotal)", "rate": "—", "base": "—", "val": grossVal.toFixed(2) },
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

            // ATP Split Engine: Exceeding stock splits delivery schedules
            const aScheduleLines = [];
            aItems.forEach(item => {
                const oMat = aMaterials.find(m => m.key === item.material);
                const stock = oMat ? oMat.stock : 10;
                const orderQty = parseFloat(item.qty) || 0;
                
                if (orderQty <= stock) {
                    // Single schedule line
                    aScheduleLines.push({
                        "itemNum": item.itemNum,
                        "line": "0001",
                        "date": (oDraft.generalInfo && oDraft.generalInfo.reqDeliveryDate) || new Date().toISOString().split("T")[0],
                        "cat": "CP",
                        "orderQty": orderQty,
                        "confQty": orderQty,
                        "movType": "601"
                    });
                } else {
                    // ATP Split: Line 1 immediate stock, Line 2 remainder 10 days later
                    aScheduleLines.push({
                        "itemNum": item.itemNum,
                        "line": "0001",
                        "date": (oDraft.generalInfo && oDraft.generalInfo.reqDeliveryDate) || new Date().toISOString().split("T")[0],
                        "cat": "CP",
                        "orderQty": stock,
                        "confQty": stock,
                        "movType": "601"
                    });
                    
                    const deliveryDate = new Date((oDraft.generalInfo && oDraft.generalInfo.reqDeliveryDate) || new Date());
                    deliveryDate.setDate(deliveryDate.getDate() + 10);
                    const lateDateString = deliveryDate.toISOString().split("T")[0];
                    
                    aScheduleLines.push({
                        "itemNum": item.itemNum,
                        "line": "0002",
                        "date": lateDateString,
                        "cat": "CP",
                        "orderQty": orderQty - stock,
                        "confQty": orderQty - stock,
                        "movType": "601"
                    });
                }
            });
            oDraft.scheduleLines = aScheduleLines;

            // Update conditions bound to selected line item
            const selectedIndex = oUIModel.getProperty("/selectedLineItemIndex") || 0;
            if (aItems[selectedIndex]) {
                oUIModel.setProperty("/selectedItemConditions", aItems[selectedIndex].conditions);
            } else {
                oUIModel.setProperty("/selectedItemConditions", []);
            }

            // Perform dynamic Customer KPI updates
            if (oCustomer) {
                const creditLimit = oCustomer.creditLimit || 0;
                const creditUsed = oCustomer.creditUsed || 0;
                oUIModel.setProperty("/creditLimitText", "$" + creditUsed.toLocaleString() + " of $" + creditLimit.toLocaleString());
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
                        oUIModel.setProperty("/draftModel", oDraftCopy);
                        this.applyCalculationsAndATP();

                        if (oDraftCopy.items && oDraftCopy.items[0]) {
                            const firstItem = oDraftCopy.items[0];
                            oUIModel.setProperty("/manualPrice", firstItem.manualPR00 !== undefined ? firstItem.manualPR00 : firstItem.price);
                            oUIModel.setProperty("/manualDiscount", firstItem.manualK007 !== undefined ? firstItem.manualK007 : -2.50);
                            oUIModel.setProperty("/manualFreight", firstItem.manualKF00 !== undefined ? firstItem.manualKF00 : 10.00);
                        }

                        const oSplitApp = this.byId("splitApp");
                        if (oSplitApp) {
                            oSplitApp.toDetail("detailPage");
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
            oUIModel.setProperty("/newOrder", {
                orderType: "",
                salesOrg: "",
                distChannel: "",
                division: "",
                soldToParty: ""
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
                docCurrency: "USD",
                soldToParty: newOrderData.soldToParty,
                docDate: new Date().toISOString().split("T")[0],
                shippingPoint: "",
                poNumber: "",
                status: "Own Draft",
                lockedBy: "",
                
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
                    incotermsLocation: "",
                    billingBlock: "",
                    deliveryBlock: "",
                    docCurrency: "USD"
                },
                items: [],
                partners: oCustomer ? [
                    { role: "SP", desc: "Sold-to Party", partnerId: newOrderData.soldToParty, name: oCustomer.desc, address: oCustomer.address },
                    { role: "SH", desc: "Ship-to Party", partnerId: newOrderData.soldToParty, name: oCustomer.desc, address: oCustomer.address },
                    { role: "BP", desc: "Bill-to Party", partnerId: newOrderData.soldToParty, name: oCustomer.desc, address: oCustomer.address },
                    { role: "PY", desc: "Payer Party", partnerId: newOrderData.soldToParty, name: oCustomer.desc, address: oCustomer.address }
                ] : [],
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
 
            // Create a clean clone of the draft payload to avoid sending UI-only fields (which CAP rejects)
            const oCleanDraft = JSON.parse(JSON.stringify(oDraft));
            
            // Helper: recursively strip any property ending in "Desc" from an object (virtual UI-only fields)
            // Also strip metadata fields starting with "@" (like @$ui5.context.isTransient)
            const stripVirtualFields = (obj) => {
                if (!obj || typeof obj !== "object") return obj;
                if (Array.isArray(obj)) return obj.map(stripVirtualFields);
                const clean = {};
                for (const key of Object.keys(obj)) {
                    if (key.endsWith("Desc")) continue; // Skip virtual description fields
                    if (key.startsWith("@")) continue; // Skip UI5/OData metadata fields
                    if (key === "conditions") continue;  // Skip UI-only pricing conditions array on items
                    if (key === "manualPR00" || key === "manualK007" || key === "manualKF00") continue; // Skip manual override flags
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
                        qty: item.qty,
                        uom: item.uom,
                        plant: item.plant,
                        storLoc: item.storLoc,
                        itemCategory: item.itemCategory,
                        price: parseFloat(item.price) || 0,
                        netValue: item.netValue,
                        shippingPoint: item.shippingPoint
                    };
                    if (item.ID) {
                        cleanItem.ID = item.ID;
                    }
                    return cleanItem;
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
                        oUIModel.setProperty("/draftModel", oMergedDraft);
                        
                        oUIModel.setProperty("/isEditing", false);
                        this.applyCalculationsAndATP();
                        MessageToast.show("Sales Order " + oDraft.salesOrder + " successfully updated.");
                        oListBinding.refresh(); // Refresh list to reflect changes
                    })
                    .catch((err) => {
                        MessageBox.error("Backend Error during Update: " + err.message);
                    });
                } else {
                    // Create the new entity in the list's context so it appears in the UI
                    const oContext = oListBinding.create(oStrippedDraft);
                    
                    oContext.created().then(() => {
                        oContext.requestObject("").then((oCreatedObject) => {
                            // Merge the created object (which contains the new database ID and generated salesOrder number)
                            // back into the existing draft so we don't lose the nested items and UI fields
                            const oMergedDraft = Object.assign({}, oDraft, oCreatedObject);
                            oUIModel.setProperty("/draftModel", JSON.parse(JSON.stringify(oMergedDraft)));
                            oUIModel.setProperty("/isEditing", false);
                            this.applyCalculationsAndATP();
                            MessageToast.show("Sales Order " + oCreatedObject.salesOrder + " successfully created.");
                            oListBinding.refresh(); // Ensure list fetches the latest DB state with UUIDs
                        });
                    }).catch((err) => {
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
                netValue: 0.00
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
            const oCtx = oItem.getBindingContext();
            const sPath = oCtx.getPath();
            const nIndex = parseInt(sPath.split("/").pop(), 10);

            const aItems = oUIModel.getProperty("/draftModel/items");
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

        onHeaderChange() {
            // Recalculates partner matrices and customer details when sold-to party changes
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const oDraft = oUIModel.getProperty("/draftModel");
            if (!oDraft) return;

            const aCustomers = oUIModel.getProperty("/F4_DATA/customer") || [];
            const oCustomer = aCustomers.find(c => c.key === oDraft.soldToParty);

            if (oCustomer) {
                // Populate partner details
                const aPartners = oDraft.partners || [];
                oDraft.partners = aPartners.map(p => {
                    if (p.role !== "AP") {
                        return {
                            role: p.role,
                            desc: p.desc,
                            partnerId: oCustomer.key,
                            name: oCustomer.desc,
                            address: oCustomer.address
                        };
                    }
                    return p;
                });
                
                // Inherit organizational details
                oDraft.paymentTerms = oCustomer.paymentTerms;
                oDraft.incotermsPart1 = oCustomer.incoterms1;
                oDraft.incotermsPart2 = oCustomer.incoterms2;
            }

            this.applyCalculationsAndATP();
        },

        /* Pricing Conditions Manual Overrides Management */
        onPricingItemChange(oEvent) {
            const oModel = this.getView().getModel();
            const oUIModel = this.getView().getModel("ui");
            const selectedIndex = parseInt(oEvent.getParameter("selectedItem").getKey(), 10);
            oUIModel.setProperty("/selectedLineItemIndex", selectedIndex);
            
            const oDraft = oUIModel.getProperty("/draftModel");
            const curItem = oDraft.items[selectedIndex];
            
            if (curItem) {
                // Reset inputs to show overrides or standard values
                oUIModel.setProperty("/manualPrice", curItem.manualPR00 !== undefined ? curItem.manualPR00 : curItem.price);
                oUIModel.setProperty("/manualDiscount", curItem.manualK007 !== undefined ? curItem.manualK007 : 0.00);
                oUIModel.setProperty("/manualFreight", curItem.manualKF00 !== undefined ? curItem.manualKF00 : 0.00);
            }

            this.applyCalculationsAndATP();
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

        /* Simulated Fiori Message Log Modal */
        onShowMessageLog() {
            MessageBox.success("S/4HANA Pre-flight system check successfully passed. VBAK and VBAP database connections are fully synchronized. 0 warnings, 0 errors.");
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

            // Otherwise, fetch dynamically from the V4 endpoint
            fetch("/sap/opu/odata4/sap/zsb_value_helps/srvd_a2x/sap/zsd_value_helps/0001/" + sEntityName)
                .then(response => {
                    if (!response.ok) throw new Error("Failed to fetch F4 data for " + sEntityName);
                    return response.json();
                })
                .then(data => {
                    const aResults = data.value || [];
                    const aMapped = aResults.map(item => {
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
                    MessageBox.error("Error loading value help: " + err.message);
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

        onMaterialHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "Material", "/F4_DATA/material", "Select Material (MARA)", "key", "desc");
        },

        onPlantHelp(oEvent) {
            this._fetchAndOpenF4(oEvent, "Plant", "/F4_DATA/plant", "Select Delivering Plant (T001W)", "key", "desc");
        },

        onStorLocHelp(oEvent) {
            this._openF4SelectDialog(oEvent, "/F4_DATA/storageLocation", "Select Storage Location (T001L)", "key", "desc", "");
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
                        oInput.setValue(oSelectedItem.getTitle());
                        
                        // Automatically update associated description field if binding exists
                        const bindingInfo = oInput.getBindingInfo("value");
                        if (bindingInfo && bindingInfo.parts && bindingInfo.parts[0]) {
                            const sPath = bindingInfo.parts[0].path;
                            if (sPath) {
                                oUIModel.setProperty(sPath + "Desc", oSelectedItem.getDescription());
                            }
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

        onSendToSAP() {
            const oUIModel = this.getView().getModel("ui");
            const oDraft = oUIModel.getProperty("/draftModel");
            if (!oDraft) {
                MessageBox.error("No active order to send to SAP.");
                return;
            }

            const payload = {
                "SalesOrderType": oDraft.orderType || "",
                "SalesOrganization": oDraft.generalInfo ? oDraft.generalInfo.salesOrg : "",
                "DistributionChannel": oDraft.generalInfo ? oDraft.generalInfo.distChannel : "",
                "OrganizationDivision": oDraft.generalInfo ? oDraft.generalInfo.division : "",
                "SoldToParty": oDraft.soldToParty || "",
                "PurchaseOrderByCustomer": oDraft.generalInfo ? oDraft.generalInfo.custRef : "",
                "TransactionCurrency": "USD",
                "ShippingCondition": oDraft.shippingRoute ? oDraft.shippingRoute.shippingConditions : "",
                "IncotermsClassification": oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart1 : "",
                "IncotermsTransferLocation": oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart2 : "",
                "IncotermsLocation1": oDraft.billingFinancial ? oDraft.billingFinancial.incotermsPart2 : "",
                "CustomerPriceGroup": "01",
                "CustomerPaymentTerms": oDraft.billingFinancial ? oDraft.billingFinancial.paymentTerms : "",
                "CustomerAccountAssignmentGroup": "01",
                "to_Partner": [],
                "to_Item": []
            };

            // Map Delivery Date if it exists
            if (oDraft.generalInfo && oDraft.generalInfo.reqDelDate) {
                payload.RequestedDeliveryDate = "/Date(" + new Date(oDraft.generalInfo.reqDelDate).getTime() + ")/";
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
                payload.to_Item = oDraft.items.map(item => ({
                    "Material": item.material,
                    "RequestedQuantity": item.qty ? item.qty.toString() : "0",
                    "RequestedQuantityUnit": item.uom,
                    "ProductionPlant": item.plant,
                    "ShippingPoint": item.shippingPoint,
                    "IncotermsClassification": payload.IncotermsClassification,
                    "TransactionCurrency": "USD",
                    "NetAmount": item.netValue ? item.netValue.toString() : "0.00",
                    "IncotermsTransferLocation": payload.IncotermsTransferLocation,
                    "IncotermsLocation1": payload.IncotermsLocation1,
                    "ProductTaxClassification1": "1",
                    "ProductTaxClassification2": "1",
                    "ProductTaxClassification3": "1",
                    "ProductTaxClassification4": "1",
                    "CustomerPaymentTerms": payload.CustomerPaymentTerms
                }));
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
                // Step 2: POST with the CSRF token
                return fetch(sServiceUrl + "A_SalesOrder", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "X-CSRF-Token": sCsrfToken
                    },
                    body: JSON.stringify(payload)
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
                var oResult = data.d || data;
                var orderId = oResult.SalesOrder || oResult.ID || "Unknown ID";

                const oUIModel = this.getView().getModel("ui");
                oUIModel.setProperty("/draftModel/sapOrderId", orderId);

                // Auto-save the CAPM draft to persist the SAP Order ID
                this.onSaveOrder();

                MessageBox.success("Order has been created with this order id: " + orderId, {
                    title: "Success",
                    actions: [MessageBox.Action.CLOSE]
                });
            })
            .catch(error => {
                sap.ui.core.BusyIndicator.hide();
                MessageBox.error("Failed to send to SAP: " + error.message);
            });
        }

    });
});
