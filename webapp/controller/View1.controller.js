sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, SelectDialog, StandardListItem) {
    "use strict";

    return Controller.extend("salesorder.controller.View1", {

        onInit() {
            // Keep default state initialized
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
            const oDraft = oModel.getProperty("/draftModel");
            if (!oDraft) {
                return;
            }

            const aMaterials = oModel.getProperty("/F4_DATA/material") || [];
            const aCustomers = oModel.getProperty("/F4_DATA/customer") || [];
            const oCustomer = aCustomers.find(c => c.key === oDraft.soldToParty);

            let nTotalDocNet = 0;
            const aItems = oDraft.items || [];

            aItems.forEach((item, index) => {
                const qty = parseFloat(item.qty) || 0;
                const oMat = aMaterials.find(m => m.key === item.material);
                const basePrice = oMat ? oMat.price : 0;
                
                // Evaluate pricing condition rates (including manual overrides)
                const pr00Rate = item.manualPR00 !== undefined ? parseFloat(item.manualPR00) : basePrice;
                const k004Rate = -5.00; // Automatic material discount
                const k007Rate = item.manualK007 !== undefined ? parseFloat(item.manualK007) : -2.50; // Customer discount
                const kf00Rate = item.manualKF00 !== undefined ? parseFloat(item.manualKF00) : 10.00; // Freight
                
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
                
                // Resolve logistical shipping point for this item: f(Shipping Conditions, Loading Group, Delivering Plant)
                const shipCond = oDraft.shippingConditions || "01";
                const loadGrp = oMat ? oMat.loadingGroup : "0001";
                let calculatedSP = "SP-" + item.plant + "-STD";
                if (shipCond === "02") {
                    calculatedSP = "SP-" + item.plant + "-EXP";
                } else if (loadGrp === "0002") {
                    calculatedSP = "SP-" + item.plant + "-CRN";
                }
                item.shippingPoint = calculatedSP;
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
                        "date": oDraft.reqDeliveryDate || new Date().toISOString().split("T")[0],
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
                        "date": oDraft.reqDeliveryDate || new Date().toISOString().split("T")[0],
                        "cat": "CP",
                        "orderQty": stock,
                        "confQty": stock,
                        "movType": "601"
                    });
                    
                    const deliveryDate = new Date(oDraft.reqDeliveryDate || new Date());
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
            const selectedIndex = oModel.getProperty("/selectedLineItemIndex") || 0;
            if (aItems[selectedIndex]) {
                oModel.setProperty("/selectedItemConditions", aItems[selectedIndex].conditions);
            } else {
                oModel.setProperty("/selectedItemConditions", []);
            }

            // Perform dynamic Customer KPI updates
            if (oCustomer) {
                const creditLimit = oCustomer.creditLimit;
                const creditUsed = oCustomer.creditUsed;
                oModel.setProperty("/creditLimitText", "$" + creditUsed.toLocaleString() + " of $" + creditLimit.toLocaleString());
                oModel.setProperty("/creditPercent", Math.round((creditUsed / creditLimit) * 100));
                oModel.setProperty("/creditYtdSales", oCustomer.ytdSales);
            } else {
                oModel.setProperty("/creditLimitText", "N/A");
                oModel.setProperty("/creditPercent", 0);
                oModel.setProperty("/creditYtdSales", 0);
            }

            oModel.setProperty("/draftIndicator", "Saved");
            oModel.updateBindings(true);
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

            oModel.setProperty("/activeOrder", true);
            oModel.setProperty("/isEditing", false);
            oModel.setProperty("/selectedLineItemIndex", 0);

            const oSelectedOrder = oCtx.getObject();
            // Deep copy to prevent modifying original data.json model until Save
            const oDraftCopy = JSON.parse(JSON.stringify(oSelectedOrder));
            oModel.setProperty("/draftModel", oDraftCopy);

            this.applyCalculationsAndATP();

            // Populate manual pricing overrides fields in model for index 0
            if (oDraftCopy.items && oDraftCopy.items[0]) {
                const firstItem = oDraftCopy.items[0];
                oModel.setProperty("/manualPrice", firstItem.manualPR00 !== undefined ? firstItem.manualPR00 : firstItem.price);
                oModel.setProperty("/manualDiscount", firstItem.manualK007 !== undefined ? firstItem.manualK007 : -2.50);
                oModel.setProperty("/manualFreight", firstItem.manualKF00 !== undefined ? firstItem.manualKF00 : 10.00);
            }

            // On phone/mobile viewports, transition to show the Detail page
            const oSplitApp = this.byId("splitApp");
            if (oSplitApp) {
                oSplitApp.toDetail("detailPage");
            }
        },

        /* Create Order (VA01 Fiori Screen Launch) */
        onCreateOrder() {
            const oModel = this.getView().getModel();
            
            // Unselect Master list selection
            const oList = this.byId("orderList");
            if (oList) {
                oList.removeSelections(true);
            }

            oModel.setProperty("/activeOrder", true);
            oModel.setProperty("/isEditing", true);
            oModel.setProperty("/selectedLineItemIndex", 0);
            oModel.setProperty("/draftIndicator", "Saving");

            // Seed fresh draft sales order
            const generatedDraftNo = "Draft-" + Math.floor(1000 + Math.random() * 9000);
            const freshDraft = {
                salesOrder: generatedDraftNo,
                orderType: "OR",
                salesOrg: "1010",
                distChannel: "10",
                division: "00",
                salesOffice: "1100",
                salesGroup: "100",
                soldToParty: "10100003",
                shipToParty: "10100003",
                poNumber: "DRAFT-PO-" + Math.floor(100 + Math.random() * 900),
                poDate: new Date().toISOString().split("T")[0],
                docDate: new Date().toISOString().split("T")[0],
                reqDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                paymentTerms: "NT30",
                incotermsPart1: "EXW",
                incotermsPart2: "New York Warehouse",
                incotermsLocation: "NY Depot",
                docCurrency: "USD",
                billingBlock: "",
                deliveryBlock: "",
                shippingConditions: "01",
                loadingGroup: "0001",
                shippingPoint: "SP-1010-STD",
                route: "US0001 - East Coast Route",
                netValue: 0,
                status: "Own Draft",
                lockedBy: "",
                items: [
                    { itemNum: "10", material: "TG11", desc: "Trading Good 11 (Standard)", qty: 10, uom: "PC", plant: "1010", storLoc: "TG00", itemCategory: "TAN", price: 250.00, netValue: 2500.00 }
                ],
                partners: [
                    { role: "SP", desc: "Sold-to Party", partnerId: "10100003", name: "US Customer Corp", address: "500 Broad St, New York, NY 10005" },
                    { role: "SH", desc: "Ship-to Party", partnerId: "10100003", name: "US Customer Corp", address: "500 Broad St, New York, NY 10005" },
                    { role: "BP", desc: "Bill-to Party", partnerId: "10100003", name: "US Customer Corp", address: "500 Broad St, New York, NY 10005" },
                    { role: "PY", desc: "Payer Party", partnerId: "10100003", name: "US Customer Corp", address: "500 Broad St, New York, NY 10005" },
                    { role: "AP", desc: "Contact Person", partnerId: "0000012055", name: "John Davis", address: "Tech Office Ext 4" }
                ],
                pricingConditions: [],
                scheduleLines: []
            };

            oModel.setProperty("/draftModel", freshDraft);
            this.applyCalculationsAndATP();

            // Populate manual pricing inputs
            const firstItem = freshDraft.items[0];
            oModel.setProperty("/manualPrice", firstItem.price);
            oModel.setProperty("/manualDiscount", -2.50);
            oModel.setProperty("/manualFreight", 10.00);

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
            const sLockedBy = oModel.getProperty("/simulatedLockUser");
            if (sLockedBy) {
                MessageBox.error("Cannot edit: Exclusive document lock held by session '" + sLockedBy + "'.");
                return;
            }

            oModel.setProperty("/isEditing", true);
            oModel.setProperty("/draftIndicator", "Saving");
            setTimeout(() => {
                oModel.setProperty("/draftIndicator", "Saved");
                oModel.updateBindings(true);
            }, 800);

            const oDraft = oModel.getProperty("/draftModel");
            const selectedIndex = oModel.getProperty("/selectedLineItemIndex") || 0;
            if (oDraft.items && oDraft.items[selectedIndex]) {
                const curItem = oDraft.items[selectedIndex];
                oModel.setProperty("/manualPrice", curItem.manualPR00 !== undefined ? curItem.manualPR00 : curItem.price);
                oModel.setProperty("/manualDiscount", curItem.manualK007 !== undefined ? curItem.manualK007 : -2.50);
                oModel.setProperty("/manualFreight", curItem.manualKF00 !== undefined ? curItem.manualKF00 : 10.00);
            }

            MessageToast.show("VA02: switched to sandboxed draft editing.");
        },

        /* Discard Current Changes */
        onDiscardDraft() {
            const oModel = this.getView().getModel();
            
            MessageBox.confirm("Are you sure you want to discard your changes?", {
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                onClose: (oAction) => {
                    if (oAction === MessageBox.Action.YES) {
                        const oList = this.byId("orderList");
                        const oSelectedItem = oList ? oList.getSelectedItem() : null;

                        if (oSelectedItem) {
                            // Revert by re-cloning original VBAK database entry
                            const oSelectedOrder = oSelectedItem.getBindingContext().getObject();
                            oModel.setProperty("/draftModel", JSON.parse(JSON.stringify(oSelectedOrder)));
                            oModel.setProperty("/isEditing", false);
                            this.applyCalculationsAndATP();
                            MessageToast.show("Changes discarded. Sandboxed locks released.");
                        } else {
                            // Close detail page if discard occurred on new VA01 creation
                            oModel.setProperty("/activeOrder", false);
                            oModel.setProperty("/isEditing", false);
                            oModel.setProperty("/draftModel", null);
                            MessageToast.show("Draft discarded.");
                        }
                    }
                }
            });
        },

        /* Save Order (VBAK/VBAP commits) */
        onSaveOrder() {
            const oModel = this.getView().getModel();
            const oDraft = oModel.getProperty("/draftModel");

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

            // Persist to local model
            oDraft.status = "Active Version";
            const aOrders = oModel.getProperty("/orders") || [];
            const nExistingIdx = aOrders.findIndex(o => o.salesOrder === oDraft.salesOrder);

            if (nExistingIdx > -1) {
                // Update
                aOrders[nExistingIdx] = JSON.parse(JSON.stringify(oDraft));
                MessageToast.show("Sales Order " + oDraft.salesOrder + " successfully committed to VBAK.");
            } else {
                // Create
                const generatedNewId = String(16000 + aOrders.length + 1);
                oDraft.salesOrder = generatedNewId;
                aOrders.unshift(JSON.parse(JSON.stringify(oDraft)));
                oModel.setProperty("/draftModel/salesOrder", generatedNewId);
                MessageToast.show("Standard Sales Order " + generatedNewId + " successfully posted!");
            }

            oModel.setProperty("/orders", aOrders);
            oModel.setProperty("/isEditing", false);
            this.applyCalculationsAndATP();
        },

        /* Toggle Simulated Session Lock */
        onToggleLock() {
            const oModel = this.getView().getModel();
            const sLock = oModel.getProperty("/simulatedLockUser");
            if (sLock) {
                oModel.setProperty("/simulatedLockUser", "");
                MessageToast.show("Document lock released. Edit mode is now available.");
            } else {
                oModel.setProperty("/simulatedLockUser", "SYSTEM_AGENT_99");
                oModel.setProperty("/isEditing", false); // Kick out of editing
                MessageToast.show("Exclusive S/4HANA lock set by SYSTEM_AGENT_99.");
            }
            oModel.updateBindings(true);
        },

        /* Line Items Management */
        onAddItem() {
            const oModel = this.getView().getModel();
            const aItems = oModel.getProperty("/draftModel/items") || [];

            const nextItemNo = String((aItems.length + 1) * 10);
            aItems.push({
                itemNum: nextItemNo,
                material: "TG11",
                desc: "Trading Good 11 (Standard)",
                qty: 1,
                uom: "PC",
                plant: "1010",
                storLoc: "TG00",
                itemCategory: "TAN",
                price: 250.00,
                netValue: 250.00
            });

            oModel.setProperty("/draftModel/items", aItems);
            this.applyCalculationsAndATP();
            
            // Select new item in dropdown
            const newIndex = aItems.length - 1;
            oModel.setProperty("/selectedLineItemIndex", newIndex);
            
            // Trigger override values reset for the newly added item
            const newItem = aItems[newIndex];
            oModel.setProperty("/manualPrice", newItem.price);
            oModel.setProperty("/manualDiscount", -2.50);
            oModel.setProperty("/manualFreight", 10.00);

            this.applyCalculationsAndATP();
        },

        onDeleteItem(oEvent) {
            const oModel = this.getView().getModel();
            const oItem = oEvent.getSource().getParent();
            const oCtx = oItem.getBindingContext();
            const sPath = oCtx.getPath();
            const nIndex = parseInt(sPath.split("/").pop(), 10);

            const aItems = oModel.getProperty("/draftModel/items");
            aItems.splice(nIndex, 1);

            // Resequence items
            aItems.forEach((item, idx) => {
                item.itemNum = String((idx + 1) * 10);
            });

            oModel.setProperty("/draftModel/items", aItems);
            oModel.setProperty("/selectedLineItemIndex", 0);
            this.applyCalculationsAndATP();
            
            MessageToast.show("Line item deleted and pricing re-evaluated.");
        },

        onItemChange(oEvent) {
            const oInput = oEvent.getSource();
            const oCtx = oInput.getBindingContext();
            const oModel = this.getView().getModel();
            const sPath = oCtx.getPath();

            const sMaterial = oModel.getProperty(sPath + "/material");
            const aMaterials = oModel.getProperty("/F4_DATA/material") || [];
            const oMat = aMaterials.find(m => m.key === sMaterial);

            if (oMat) {
                oModel.setProperty(sPath + "/desc", oMat.desc);
                oModel.setProperty(sPath + "/price", oMat.price);
                oModel.setProperty(sPath + "/uom", oMat.uom);
                oModel.setProperty(sPath + "/plant", oMat.defaultPlant);
                
                // Clear any manual overrides when material is changed
                oModel.setProperty(sPath + "/manualPR00", undefined);
                oModel.setProperty(sPath + "/manualK007", undefined);
                oModel.setProperty(sPath + "/manualKF00", undefined);
            }

            this.applyCalculationsAndATP();
        },

        onHeaderChange() {
            // Recalculates partner matrices and customer details when sold-to party changes
            const oModel = this.getView().getModel();
            const oDraft = oModel.getProperty("/draftModel");
            if (!oDraft) return;

            const aCustomers = oModel.getProperty("/F4_DATA/customer") || [];
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
            const selectedIndex = parseInt(oEvent.getParameter("selectedItem").getKey(), 10);
            oModel.setProperty("/selectedLineItemIndex", selectedIndex);
            
            const oDraft = oModel.getProperty("/draftModel");
            const curItem = oDraft.items[selectedIndex];
            
            if (curItem) {
                // Reset inputs to show overrides or standard values
                oModel.setProperty("/manualPrice", curItem.manualPR00 !== undefined ? curItem.manualPR00 : curItem.price);
                oModel.setProperty("/manualDiscount", curItem.manualK007 !== undefined ? curItem.manualK007 : -2.50);
                oModel.setProperty("/manualFreight", curItem.manualKF00 !== undefined ? curItem.manualKF00 : 10.00);
            }

            this.applyCalculationsAndATP();
        },

        onPricingOverrideChange() {
            const oModel = this.getView().getModel();
            const selectedIndex = oModel.getProperty("/selectedLineItemIndex") || 0;
            const oDraft = oModel.getProperty("/draftModel");
            const curItem = oDraft.items[selectedIndex];

            if (curItem) {
                const manualPrice = oModel.getProperty("/manualPrice");
                const manualDiscount = oModel.getProperty("/manualDiscount");
                const manualFreight = oModel.getProperty("/manualFreight");

                curItem.manualPR00 = manualPrice !== "" ? parseFloat(manualPrice) : undefined;
                curItem.manualK007 = manualDiscount !== "" ? parseFloat(manualDiscount) : undefined;
                curItem.manualKF00 = manualFreight !== "" ? parseFloat(manualFreight) : undefined;
            }

            oModel.setProperty("/draftIndicator", "Saving");
            setTimeout(() => {
                this.applyCalculationsAndATP();
            }, 800);
        },

        /* Simulated Fiori Message Log Modal */
        onShowMessageLog() {
            MessageBox.success("S/4HANA Pre-flight system check successfully passed. VBAK and VBAP database connections are fully synchronized. 0 warnings, 0 errors.");
        },

        /* ================== DYNAMIC VALUE HELP DIALOGS (F4 Suggestions) ================== */
        onSoldToHelp(oEvent) {
            this._openF4SelectDialog(oEvent, "/F4_DATA/customer", "Select Sold-To Customer (KNA1)", "key", "desc", "address");
        },

        onShipToHelp(oEvent) {
            this._openF4SelectDialog(oEvent, "/F4_DATA/customer", "Select Ship-To Party (KNA1)", "key", "desc", "address");
        },

        onMaterialHelp(oEvent) {
            this._openF4SelectDialog(oEvent, "/F4_DATA/material", "Select Material (MARA)", "key", "desc", "price");
        },

        onPlantHelp(oEvent) {
            this._openF4SelectDialog(oEvent, "/F4_DATA/plant", "Select Delivering Plant (T001W)", "key", "desc", "");
        },

        onStorLocHelp(oEvent) {
            this._openF4SelectDialog(oEvent, "/F4_DATA/storageLocation", "Select Storage Location (T001L)", "key", "desc", "");
        },

        _openF4SelectDialog(oEvent, sDataPath, sTitle, sTitleProp, sDescProp, sInfoProp) {
            const oInput = oEvent.getSource();
            const oModel = this.getView().getModel();
            const aItems = oModel.getProperty(sDataPath) || [];

            const oSelectDialog = new SelectDialog({
                title: sTitle,
                items: aItems.map(item => new StandardListItem({
                    title: item[sTitleProp],
                    description: item[sDescProp],
                    info: sInfoProp ? (typeof item[sInfoProp] === 'number' ? "$" + item[sInfoProp] : item[sInfoProp]) : ""
                })),
                confirm: (oConfirmEvent) => {
                    const oSelectedItem = oConfirmEvent.getParameter("selectedItem");
                    if (oSelectedItem) {
                        oInput.setValue(oSelectedItem.getTitle());
                        oInput.fireChange(); // Trigger calculations
                    }
                }
            });
            oSelectDialog.open();
        }

    });
});