// pos_overrides.js
// Refactored POS Mobile enhancements with improved architecture
// Loads only on the Point of Sale page via hooks.page_js
// Keep everything idempotent and scoped.

(function () {
	if (!window.frappe) return;

	// Configuration and constants
	const CONFIG = {
		TIMING: {
			POLLING_INTERVAL: 1500,
			RETRY_ATTEMPTS: 20,
			RETRY_DELAY: 600,
			SCROLL_DELAY: 120,
			ANIMATION_DURATION: 200
		},
		CLASSES: {
			POS_CONTAINER: '.point-of-sale-app',
			PAYMENT_CONTAINER: '.payment-container',
			ITEMS_SELECTOR: '.items-selector',
			CART_CONTAINER: '.customer-cart-container',
			FILTER_SECTION: '.filter-section',
			SELECTED_ITEMS_BTN: '.selected-items-btn',
			VIEW_SELECTED_WRAPPER: '.view-selected-wrapper',
			MODE_OF_PAYMENT: '.mode-of-payment',
			TOTALS_SECTION: '.totals-section',
			CART_BADGE: '.cart-badge'
		},
		BREAKPOINTS: {
			MOBILE: 480,
			TABLET: 768,
			DESKTOP: 901
		}
	};

	// Enhanced error handling
	const safeExecute = (fn, context = '', fallback = null) => {
		try {
			return fn();
		} catch (error) {
			console.warn(`[POS Mobile] ${context}:`, error);
			return fallback;
		}
	};

	// Enhanced smooth scroll helper
	function strongScrollIntoView(element) {
		return safeExecute(() => {
			const el = element && element.jquery ? element.get(0) : element;
			if (!el) return;

			const doScroll = () => el.scrollIntoView({
				behavior: 'smooth',
				block: 'start',
				inline: 'nearest'
			});

			if (window.requestAnimationFrame) {
				requestAnimationFrame(() => {
					doScroll();
					setTimeout(doScroll, CONFIG.TIMING.SCROLL_DELAY);
				});
			} else {
				doScroll();
				setTimeout(doScroll, CONFIG.TIMING.SCROLL_DELAY);
			}
		}, 'strongScrollIntoView');
	}

	// Wait for POS to be ready with improved retry logic
	function onPOSReady(cb) {
		const check = setInterval(() => {
			const container = document.querySelector(CONFIG.CLASSES.POS_CONTAINER) ||
							document.querySelector(CONFIG.CLASSES.PAYMENT_CONTAINER);
			if (container) {
				clearInterval(check);
				cb();
			}
		}, CONFIG.TIMING.RETRY_DELAY);
	}

	// Inject styles
	function injectStylesOnce() {
		const id = 'pos-mobile-plus-styles';
		if (document.getElementById(id)) return;

		const style = document.createElement('style');
		style.id = id;
		style.textContent = `
			/* Modernize payment cards and totals on both desktop and mobile */
			.payment-container .submit-order-btn { position: static; width: 100%; height: 48px; display: flex; align-items: center; justify-content: center; background: var(--btn-primary); color: var(--neutral); border-radius: var(--border-radius-md); margin-top: var(--padding-sm); }
			.payment-container .submit-order-btn:active { transform: translateY(1px); filter: brightness(.95); }
			.payment-container .payment-modes { display: grid; grid-gap: 10px; }
			@media (max-width: ${CONFIG.BREAKPOINTS.MOBILE}px) { .payment-container .payment-modes { grid-template-columns: 1fr; } }
			@media (min-width: ${CONFIG.BREAKPOINTS.MOBILE + 1}px) and (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) { .payment-container .payment-modes { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
			.payment-container .payment-mode-wrapper { margin: 0; }
			.payment-container .mode-of-payment { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: var(--border-radius-md); border: 1px solid var(--border-color); background: var(--bg-color); box-shadow: 0 1px 2px rgba(0,0,0,.05); }
			.payment-container .mode-of-payment:hover { box-shadow: 0 2px 6px rgba(0,0,0,.06); }
			.payment-container .mode-of-payment.border-primary { border-color: var(--btn-primary); background: linear-gradient(0deg, rgba(0, 122, 255, .06), rgba(0,122,255,.06)); box-shadow: 0 0 0 1px rgba(0, 122, 255, .18) inset, 0 2px 6px rgba(0,0,0,.06); }
			.payment-container .mode-of-payment.border-primary::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--btn-primary); opacity: .9; }
			.payment-container .mode-of-payment .pay-amount { margin-left: auto; font-weight: 600; }
			.payment-container .number-pad .numpad-btn { height: 56px; font-size: 18px; border-radius: var(--border-radius-md); box-shadow: 0 1px 1px rgba(0,0,0,.04); }
			.payment-container .number-pad .numpad-btn:active { transform: translateY(1px); }
			.payment-container .number-pad { gap: 10px; }
			.payment-container .totals-section { margin-top: 10px; }
			.payment-container .totals-section .totals { display: grid; grid-gap: 10px; }
			@media (max-width: ${CONFIG.BREAKPOINTS.MOBILE}px) { .payment-container .totals-section .totals { grid-template-columns: 1fr; } }
			@media (min-width: ${CONFIG.BREAKPOINTS.MOBILE + 1}px) and (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) { .payment-container .totals-section .totals { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
			.payment-container .totals-section .totals .col { background: var(--bg-color); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); padding: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.06); display: flex; flex-direction: column; gap: 4px; }
			.payment-container .totals-section .totals .total-label { font-size: 12px; color: var(--text-muted); }
			.payment-container .totals-section .totals .value { font-weight: 700; }
			.payment-container .totals-section .totals .grand-total .value { color: var(--orange-600, #c05621); }
			.payment-container .totals-section .totals .paid-amount .value { color: var(--blue-600, #2563eb); }
			.payment-container .totals-section .totals .remaining-amount .value.text-danger { color: var(--red-600, #dc2626); }
			.payment-container .totals-section .totals .remaining-amount .value.text-success { color: var(--green-600, #16a34a); }
			@media (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) { .payment-container .totals-section .seperator-y { display: none; } }
			.customer-cart-container .cart-totals-section { position: sticky; bottom: 0; background: var(--bg-color); z-index: 1; }
			.items-selector .filter-section { display: flex !important; flex-wrap: wrap !important; gap: 8px; }
			.items-selector .view-selected-wrapper { flex: 0 0 100% !important; width: 100% !important; min-width: 100% !important; display: flex; align-items: center; margin-top: 8px; order: 99; }
			.items-selector .items-container { display: grid; grid-gap: var(--padding-sm); }
			@media (max-width: 420px) { .items-selector .items-container { grid-template-columns: repeat(2, minmax(0,1fr)); } }
			@media (min-width: 421px) and (max-width: 640px) { .items-selector .items-container { grid-template-columns: repeat(3, minmax(0,1fr)); } }
			@media (min-width: 641px) and (max-width: 900px) { .items-selector .items-container { grid-template-columns: repeat(4, minmax(0,1fr)); } }
			@media (min-width: 901px) { .items-selector .items-container { grid-template-columns: repeat(5, minmax(0,1fr)); } }
			@keyframes posBtnPulse { 0% { box-shadow: 0 0 0 0 rgba(0, 122, 255, .35);} 70% { box-shadow: 0 0 0 8px rgba(0, 122, 255, 0);} 100% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0);} }
			.items-selector .selected-items-btn { width: 100% !important; height: 36px; padding: 0 12px; font-size: 16px; border: none; border-radius: var(--border-radius-md); background: #000000ff; color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08); animation: posBtnPulse 2s ease-out infinite; }
			@media (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) { .items-selector .selected-items-btn { display: flex !important; justify-content: center; align-items: center; } }
			@media (min-width: ${CONFIG.BREAKPOINTS.TABLET + 1}px) { .items-selector .selected-items-btn { display: none; } }
			.cart-badge { position: absolute; top: 6px; left: 6px; min-width: 20px; height: 20px; border-radius: 10px; background: var(--btn-primary); color: var(--neutral); font-size: 12px; line-height: 20px; text-align: center; padding: 0 6px; display: none; z-index: 10; }
			.item-wrapper { position: relative; }
		`;
		document.head.appendChild(style);
	}

	// Accessibility + cart button count
	function enhanceAccessibility() {
		return safeExecute(() => {
			const totals = document.querySelector('.payment-container .totals');
			if (totals) {
				totals.setAttribute('role', 'region');
				totals.setAttribute('aria-live', 'polite');
				totals.setAttribute('aria-label', frappe._('Payment totals'));
			}

			const updateCartButtonCount = () => {
				safeExecute(() => {
					const frm = cur_pos && cur_pos.frm ? cur_pos.frm : (locals && locals.cur_frm ? locals.cur_frm : null);
					const doc = frm ? frm.doc : {};
					const total_qty = (doc?.items || []).reduce((acc, i) => acc + (parseFloat(i.qty) || 0), 0);
					const btn = document.querySelector('.items-selector .selected-items-btn');
					if (btn) {
						const baseLabel = frappe._('Item Cart');
						btn.textContent = total_qty > 0 ? `${baseLabel} (${total_qty})` : baseLabel;
					}
				}, 'updateCartButtonCount');
			};
			setInterval(updateCartButtonCount, CONFIG.TIMING.POLLING_INTERVAL);
		}, 'enhanceAccessibility');
	}

	// Add Item Cart button with scrolling
	function addViewSelectedItemsButton() {
		return safeExecute(() => {
			const filter = document.querySelector('.items-selector .filter-section');
			const cartContainer = document.querySelector('.customer-cart-container');
			if (!filter || !cartContainer) return;

			let btn = filter.querySelector('.selected-items-btn');
			let wrapper = btn ? btn.closest('.view-selected-wrapper') : null;
			if (!btn) {
				wrapper = document.createElement('div');
				wrapper.className = 'view-selected-wrapper';
				const newBtn = document.createElement('button');
				newBtn.className = 'view-selected-btn selected-items-btn';
				newBtn.setAttribute('aria-label', frappe._('Item Cart'));
				btn = newBtn;
				wrapper.appendChild(btn);
				filter.appendChild(wrapper);
			}

			if (wrapper) {
				wrapper.style.cssText = 'flex: 0 0 100% !important; width:100% !important; min-width:100%; margin-left:0; display:flex; align-items:center; margin-top:8px;';
			}

			btn.style.cssText = 'display:none; flex: 0 0 100%; width:100% !important; height:36px; padding:0 12px; font-size:16px; border:none; border-radius:var(--border-radius-md); background:#000000ff; color:#fff; box-shadow:0 1px 2px rgba(0,0,0,.08); box-sizing:border-box;';

			safeExecute(() => {
				const frm = cur_pos && cur_pos.frm ? cur_pos.frm : (locals && locals.cur_frm ? locals.cur_frm : null);
				const doc = frm ? frm.doc : {};
				const total_qty = (doc?.items || []).reduce((acc, i) => acc + (parseFloat(i.qty) || 0), 0);
				const baseLabel = frappe._('Item Cart');
				btn.textContent = total_qty > 0 ? `${baseLabel} (${total_qty})` : baseLabel;
			}, 'initializeCartButton');

			const updateBtnVisibility = () => {
				safeExecute(() => {
					const isMobile = (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) || (window.matchMedia && window.matchMedia(`(max-width: ${CONFIG.BREAKPOINTS.TABLET}px)`).matches);
					if (isMobile) {
						btn.style.display = 'flex';
						btn.style.alignItems = 'center';
						btn.style.justifyContent = 'center';
					} else {
						btn.style.display = 'none';
					}
				}, 'updateBtnVisibility');
			};
			updateBtnVisibility();
			window.addEventListener('resize', updateBtnVisibility);

			btn.addEventListener('click', () => strongScrollIntoView(cartContainer));
		}, 'addViewSelectedItemsButton');
	}

	// Main init
	onPOSReady(() => {
		injectStylesOnce();
		enhanceAccessibility();
		addViewSelectedItemsButton();

		// Ensure button exists after delayed renders
		safeExecute(() => {
			let tries = 0;
			const iv = setInterval(() => {
				const filter = document.querySelector('.items-selector .filter-section');
				const hasBtn = filter && filter.querySelector('.selected-items-btn');
				if (hasBtn || tries > 15) {
					clearInterval(iv);
					return;
				}
				addViewSelectedItemsButton();
				tries++;
			}, CONFIG.TIMING.RETRY_DELAY);
		}, 'retryItemSelector');

		// Patch POS Controller
		safeExecute(() => {
			if (erpnext && erpnext.PointOfSale && erpnext.PointOfSale.Controller) {
				const C = erpnext.PointOfSale.Controller;
				if (!C.__posMobilePatched) {
					C.__posMobilePatched = true;
					const orig_update_cart_html = C.prototype.update_cart_html;
					C.prototype.update_cart_html = function (item_row, remove_item) {
						orig_update_cart_html && orig_update_cart_html.call(this, item_row, remove_item);
						safeExecute(() => {
							if (this.item_selector && typeof this.item_selector.update_cart_badges === 'function') {
								this.item_selector.update_cart_badges();
							}
						}, 'updateCartBadges');
					};

					const orig_toggle_components = C.prototype.toggle_components;
					C.prototype.toggle_components = function (show) {
						orig_toggle_components && orig_toggle_components.call(this, show);
						if (show) {
							safeExecute(() => { this.$components_wrapper && strongScrollIntoView(this.$components_wrapper.get(0)); }, 'toggleComponentsScroll');
						}
					};
				}
			}
		}, 'patchMainController');

		// Patch ItemDetails.toggle_component
		safeExecute(() => {
			if (erpnext?.PointOfSale?.ItemDetails && !erpnext.PointOfSale.ItemDetails.__posMobilePatched) {
				erpnext.PointOfSale.ItemDetails.__posMobilePatched = true;
				const ID = erpnext.PointOfSale.ItemDetails;
				const orig_toggle = ID.prototype.toggle_component;
				ID.prototype.toggle_component = function (show) {
					orig_toggle && orig_toggle.call(this, show);
					if (show) {
						safeExecute(() => { this.$component && strongScrollIntoView(this.$component.get(0)); }, 'itemDetailsScroll');
					}
				};
			}
		}, 'patchItemDetails');

		// Auto-scroll to items after customer selected
		safeExecute(() => {
			const customerSection = document.querySelector('.customer-cart-container .customer-section');
			if (customerSection) {
				const mo = new MutationObserver(() => {
					const hasDetails = customerSection.querySelector('.customer-details');
					if (hasDetails) {
						const itemsSelector = document.querySelector('.items-selector');
						itemsSelector && strongScrollIntoView(itemsSelector);
					}
				});
				mo.observe(customerSection, { childList: true, subtree: true });
			}
		}, 'observeCustomerSelection');

		// Patch Payment behaviors
		safeExecute(() => {
			if (erpnext?.PointOfSale?.Payment && !erpnext.PointOfSale.Payment.__posMobilePatched) {
				erpnext.PointOfSale.Payment.__posMobilePatched = true;
				const P = erpnext.PointOfSale.Payment;

				const orig_bind = P.prototype.bind_events;
				P.prototype.bind_events = function () {
					orig_bind && orig_bind.call(this);
					safeExecute(() => {
						this.$payment_modes.off('click.pos_mobile_a11y').on('click.pos_mobile_a11y', '.mode-of-payment', (e) => {
							const $clicked = $(e.currentTarget);
							$clicked.attr('aria-selected', 'true').attr('role', 'button');
							$clicked.parent().siblings().find('.mode-of-payment').attr('aria-selected', 'false');
						});
					}, 'paymentAccessibility');

					safeExecute(() => {
						$(document).off('keydown.pos_mobile_delete').on('keydown.pos_mobile_delete', (e) => {
							if (!this.$component.is(':visible')) return;
							if (!this.selected_mode) return;
							const key = (e.key === 'Delete') ? 'Backspace' : e.key;
							if (key !== e.key) {
								this.on_numpad_clicked(key, false);
								e.preventDefault();
							}
						});
					}, 'paymentKeyboard');
				};

				const orig_checkout = P.prototype.checkout;
				P.prototype.checkout = function () {
					orig_checkout && orig_checkout.call(this);
					safeExecute(() => {
						if (this._pos_mobile_refresh) clearInterval(this._pos_mobile_refresh);
						this._pos_mobile_refresh = setInterval(() => {
							safeExecute(() => {
								const doc = this.events.get_frm().doc;
								this.update_totals_section(doc);
								this.render_payment_mode_dom();
							}, 'paymentRefresh');
						}, 1000);
						safeExecute(() => { this.$component && strongScrollIntoView(this.$component.get(0)); }, 'paymentScroll');
					}, 'paymentCheckout');
				};

				const orig_toggle_pay = P.prototype.toggle_component;
				P.prototype.toggle_component = function (show) {
					orig_toggle_pay && orig_toggle_pay.call(this, show);
					if (!show && this._pos_mobile_refresh) {
						clearInterval(this._pos_mobile_refresh);
						this._pos_mobile_refresh = null;
					}
				};
			}
		}, 'patchPayment');

		// Provide update_cart_badges + periodic sync
		safeExecute(() => {
			const IS = erpnext?.PointOfSale?.ItemSelector;
			if (IS && !IS.prototype.update_cart_badges) {
				IS.prototype.update_cart_badges = function () {
					safeExecute(() => {
						const frm = this.events.get_frm();
						const doc = frm?.doc || {};
						const items = doc.items || [];
						const tileList = document.querySelectorAll('.items-selector .item-wrapper');
						tileList.forEach((tile) => {
							const code = unescape(tile.getAttribute('data-item-code') || '');
							const uom = unescape(tile.getAttribute('data-uom') || '');
							const qty = items.filter((i) => i.item_code === code && (!uom || i.uom === uom)).reduce((acc, i) => acc + (parseFloat(i.qty) || 0), 0);
							let badge = tile.querySelector('.cart-badge');
							if (!badge) {
								badge = document.createElement('div');
								badge.className = 'cart-badge';
								badge.style.cssText = 'position:absolute;top:6px;left:6px;min-width:20px;height:20px;border-radius:10px;background:var(--btn-primary);color:var(--neutral);font-size:12px;line-height:20px;text-align:center;padding:0 6px;display:none;';
								tile.style.position = 'relative';
								tile.appendChild(badge);
							}
							if (qty > 0) {
								badge.textContent = qty;
								badge.style.display = 'inline-block';
							} else {
								badge.style.display = 'none';
							}
						});

						const btn = document.querySelector('.items-selector .selected-items-btn');
						if (btn) {
							const total_qty = items.reduce((acc, i) => acc + (parseFloat(i.qty) || 0), 0);
							const baseLabel = frappe._('Item Cart');
							btn.textContent = total_qty > 0 ? `${baseLabel} (${total_qty})` : baseLabel;
						}
					}, 'updateCartBadges');
				};
				setInterval(() => {
					safeExecute(() => {
						const selector = cur_pos?.item_selector;
						selector && selector.update_cart_badges && selector.update_cart_badges();
					}, 'badgeRefresh');
				}, CONFIG.TIMING.POLLING_INTERVAL);
			}
		}, 'patchItemSelector');

		// Patch PastOrderList to add auto-scroll when order is selected
		safeExecute(() => {
			if (erpnext?.PointOfSale?.PastOrderList && !erpnext.PointOfSale.PastOrderList.__posMobilePatched) {
				erpnext.PointOfSale.PastOrderList.__posMobilePatched = true;
				const POL = erpnext.PointOfSale.PastOrderList;
				
				const orig_bind_events = POL.prototype.bind_events;
				POL.prototype.bind_events = function() {
					// Call original bind_events first
					orig_bind_events && orig_bind_events.call(this);
					
					// Override the click handler to add auto-scroll
					const me = this;
					this.$invoices_container.off('click', '.invoice-wrapper');
					this.$invoices_container.on('click', '.invoice-wrapper', function() {
						const invoice_clicked = $(this);
						const invoice_doctype = invoice_clicked.attr('data-invoice-doctype');
						const invoice_name = unescape(invoice_clicked.attr('data-invoice-name'));

						$('.invoice-wrapper').removeClass('invoice-selected');
						invoice_clicked.addClass('invoice-selected');

						// Call the original event handler
						me.events.open_invoice_data(invoice_doctype, invoice_name);
						
						// Auto-scroll to order summary after a short delay
						safeExecute(() => {
							setTimeout(() => {
								const orderSummary = document.querySelector('.past-order-summary');
								if (orderSummary) {
									strongScrollIntoView(orderSummary);
								}
							}, CONFIG.TIMING.ANIMATION_DURATION);
						}, 'recentOrderScroll');
					});
				};
			}
		}, 'patchPastOrderList');

		// Patch PastOrderSummary to ensure scroll happens when summary is loaded
		safeExecute(() => {
			if (erpnext?.PointOfSale?.PastOrderSummary && !erpnext.PointOfSale.PastOrderSummary.__posMobilePatched) {
				erpnext.PointOfSale.PastOrderSummary.__posMobilePatched = true;
				const POS = erpnext.PointOfSale.PastOrderSummary;
				
				const orig_load_summary = POS.prototype.load_summary_of;
				POS.prototype.load_summary_of = function(doc, after_submission = false) {
					// Call original method
					orig_load_summary && orig_load_summary.call(this, doc, after_submission);
					
					// Auto-scroll to the summary component after it's loaded
					safeExecute(() => {
						setTimeout(() => {
							if (this.$component && this.$component.is(':visible')) {
								strongScrollIntoView(this.$component.get(0));
							}
						}, CONFIG.TIMING.ANIMATION_DURATION + 100);
					}, 'orderSummaryScroll');
				};
			}
		}, 'patchPastOrderSummary');

		// Auto-confirm submission popup for POS Invoice
		safeExecute(() => {
			const Form = frappe?.ui?.form?.Form;
			if (Form && !Form.__posMobileAutoConfirmPatched) {
				Form.__posMobileAutoConfirmPatched = true;
				const orig = Form.prototype.savesubmit;
				Form.prototype.savesubmit = function (btn, callback, on_error) {
					const isPOSInvoice = this?.doctype === 'POS Invoice' && window.cur_pos;
					if (isPOSInvoice) {
						const me = this;
						return new Promise((resolve) => {
							me.validate_form_action('Submit');
							frappe.validated = true;
							me.script_manager.trigger('before_submit').then(function () {
								if (!frappe.validated) {
									return me.handle_save_fail(btn, on_error);
								}
								me.save(
									'Submit',
									function (r) {
										if (r.exc) {
											me.handle_save_fail(btn, on_error);
										} else {
											frappe.utils.play_sound('submit');
											callback && callback();
											me.script_manager
												.trigger('on_submit')
												.then(() => resolve(me))
												.then(() => {
													if (frappe.route_hooks?.after_submit) {
														let route_callback = frappe.route_hooks.after_submit;
														delete frappe.route_hooks.after_submit;
														route_callback(me);
													}
												});
										}
									},
									btn,
									() => me.handle_save_fail(btn, on_error),
									resolve
								);
							});
						});
					}
					return orig ? orig.call(this, btn, callback, on_error) : undefined;
				};
			}
		}, 'autoConfirmSubmitPOS');
	});

	// Expose minimal API for debugging
	window.POSMobile = {
		config: CONFIG,
		scrollToView: strongScrollIntoView
	};

})();
