// pos_overrides.js
// Refactored POS Mobile enhancements with improved architecture
// Loads only on the Point of Sale page via hooks.page_js
// Keep everything idempotent and scoped.

(function () {
	if (!window.frappe) return;

	// Configuration and constants
	const CONFIG = {
		TIMING: {
			POLLING_INTERVAL: 100,
			RETRY_ATTEMPTS: 20,
			RETRY_DELAY: 100,
			SCROLL_DELAY: 80,
			ANIMATION_DURATION: 100
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
			/* Item Details Cart Button - Mobile Only */
			@media (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) {
				.item-details-container .item-cart-btn { position: sticky; bottom: 0; width: 100%; height: 48px; margin-top: 16px; background: var(--btn-primary); color: var(--neutral); border: none; border-radius: var(--border-radius-md); font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,.15); z-index: 10; }
				.item-details-container .item-cart-btn:active { transform: translateY(1px); filter: brightness(.95); }
				.item-details-container .item-cart-btn .cart-count { margin-left: 8px; background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 12px; font-size: 14px; }
			}
			@media (min-width: ${CONFIG.BREAKPOINTS.TABLET + 1}px) {
				.item-details-container .item-cart-btn { display: none !important; }
			}

			/* Floating New Invoice button - Mobile Only */
			@media (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) {
				.pos-new-invoice-fab { position: fixed; top: 72px; right: 12px; height: 36px; padding: 0 14px; border-radius: var(--border-radius-md); background: var(--btn-primary); color: var(--neutral); border: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; z-index: 1500; box-shadow: 0 2px 8px rgba(0,0,0,.15); cursor: pointer; }
				.pos-new-invoice-fab:active { transform: translateY(1px); filter: brightness(.95); }
				@media (max-width: 480px) { .pos-new-invoice-fab { top: 84px; right: 8px; height: 34px; padding: 0 12px; font-size: 13px; } }
			}
			@media (min-width: ${CONFIG.BREAKPOINTS.TABLET + 1}px) {
				.pos-new-invoice-fab { display: none !important; }
			}
			/* Only show the New Invoice FAB on POS page and mobile */
			body.pos-mobile-active .pos-new-invoice-fab { display: flex !important; }

			/* Desktop: Standard order summary layout */
			@media (min-width: ${CONFIG.BREAKPOINTS.TABLET + 1}px) {
				.point-of-sale-app > .past-order-summary { overflow: visible !important; }
				.point-of-sale-app > .past-order-summary .invoice-summary-wrapper { width: 100% !important; overflow: visible !important; }
				.point-of-sale-app > .past-order-summary .abs-container { position: relative !important; padding-bottom: 20px !important; }
				.point-of-sale-app > .past-order-summary .summary-btns { position: sticky; bottom: 0; display: flex !important; gap: 8px; padding: 12px 16px; background: var(--bg-color); border-top: 1px solid var(--border-color); z-index: 2; }
				.point-of-sale-app > .past-order-summary .summary-btn { flex: 1 1 auto; min-height: 40px; }
				.point-of-sale-app > .past-order-summary .new-btn { background-color: var(--btn-primary) !important; color: var(--neutral) !important; border-color: var(--btn-primary) !important; }
			}

			/* Mobile: Prevent page header actions cutoff on POS */
			@media (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) {
				body.pos-mobile-active .page-head,
				body.pos-mobile-active .page-head .container,
				body.pos-mobile-active .page-head .page-actions,
				body.pos-mobile-active .page-head .page-actions .custom-actions { overflow: visible !important; }
				body.pos-mobile-active .page-head .container { max-width: 100% !important; width: 100% !important; padding-right: 12px !important; }
				body.pos-mobile-active .page-head .page-actions { display: flex !important; flex-wrap: wrap !important; align-items: center !important; justify-content: flex-end !important; gap: 6px !important; padding-right: 8px !important; max-width: 100% !important; }
				body.pos-mobile-active .page-head .page-actions > * { flex: 0 0 auto !important; }
				body.pos-mobile-active .page-head .page-actions .btn { white-space: nowrap !important; padding: 4px 10px !important; font-size: 12px !important; line-height: 1.2 !important; }
				body.pos-mobile-active .page-head .page-actions .primary-action { display: none !important; }
			}
			/* Mobile responsive CSS for New Invoice button */
			@media screen and (max-width: 620px) {
				.point-of-sale-app > .past-order-summary {
					overflow: visible !important;
					height: auto !important;
					min-height: 100vh !important;
					max-height: none !important;
				}
				.point-of-sale-app > .past-order-summary .invoice-summary-wrapper {
					width: 100% !important;
					max-width: 100% !important;
					height: auto !important;
					min-height: 100vh !important;
					max-height: none !important;
					overflow: visible !important;
					position: relative !important;
				}
				.point-of-sale-app > .past-order-summary .abs-container {
					position: relative !important;
					height: auto !important;
					min-height: calc(100vh - 120px) !important;
					max-height: none !important;
					padding: 16px !important;
					overflow: visible !important;
					display: flex !important;
					flex-direction: column !important;
				}
				.point-of-sale-app > .past-order-summary .summary-btns {
					display: flex !important;
					flex-direction: column !important;
					gap: 12px !important;
					padding: 16px 0 !important;
					margin: 0 !important;
					position: fixed !important;
					bottom: 0 !important;
					left: 0 !important;
					right: 0 !important;
					background: var(--fg-color) !important;
					border-top: 1px solid var(--border-color) !important;
					z-index: 1000 !important;
					box-shadow: 0 -2px 8px rgba(0,0,0,0.1) !important;
				}
				.point-of-sale-app > .past-order-summary .summary-btn {
					width: calc(100% - 32px) !important;
					flex: none !important;
					margin: 0 16px !important;
					padding: 16px 20px !important;
					font-size: 16px !important;
					font-weight: 600 !important;
					border-radius: var(--border-radius-md) !important;
					min-height: 52px !important;
					display: flex !important;
					align-items: center !important;
					justify-content: center !important;
					box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
				}
				.point-of-sale-app > .past-order-summary .new-btn {
					background-color: var(--btn-primary) !important;
					color: var(--neutral) !important;
					font-weight: 600 !important;
					order: -1 !important; /* Make New Invoice button appear first */
					box-shadow: 0 4px 8px rgba(0,0,0,0.15) !important;
				}
				/* Ensure all content is visible and add bottom padding for fixed buttons */
				.point-of-sale-app > .past-order-summary .summary-container {
					margin-bottom: 16px !important;
					overflow: visible !important;
				}
				/* Add bottom padding to prevent content from being hidden behind fixed buttons */
				.point-of-sale-app > .past-order-summary .abs-container {
					padding-bottom: 120px !important;
				}
			}
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
			setInterval(() => {
				if (document.hidden) return;
				updateCartButtonCount();
			}, CONFIG.TIMING.POLLING_INTERVAL);
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
			window.addEventListener('resize', updateBtnVisibility, { passive: true });

			btn.addEventListener('click', () => strongScrollIntoView(cartContainer));
		}, 'addViewSelectedItemsButton');
	}

	// Add mobile-only New Invoice floating button
	function addNewInvoiceFAB() {
		return safeExecute(() => {
			const isMobile = (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) || (window.matchMedia && window.matchMedia(`(max-width: ${CONFIG.BREAKPOINTS.TABLET}px)`).matches);
			if (!isMobile) return;
			
			const container = document.querySelector(CONFIG.CLASSES.POS_CONTAINER);
			if (!container) return;
			if (document.querySelector('.pos-new-invoice-fab')) return;
			
			const btn = document.createElement('button');
			btn.className = 'pos-new-invoice-fab';
			btn.setAttribute('aria-label', frappe._('New Invoice'));
			btn.textContent = frappe._('New');
			btn.addEventListener('click', () => {
				safeExecute(() => {
					const ctrl = window.cur_pos;
					if (ctrl && typeof ctrl.make_new_invoice === 'function') {
						ctrl.make_new_invoice();
					} else if (ctrl && typeof ctrl.order_summary?.events?.new_order === 'function') {
						ctrl.order_summary.events.new_order();
					}
				}, 'newInvoiceFABClick');
			});
			document.body.appendChild(btn);
		}, 'addNewInvoiceFAB');
	}

	// Main init
	onPOSReady(() => {
		// mark body so header tweaks are scoped to POS only
		try { document.body.classList.add('pos-mobile-active'); } catch (e) {}
		injectStylesOnce();
		enhanceAccessibility();
		addViewSelectedItemsButton();
		addNewInvoiceFAB();

		// Ensure button exists after delayed renders
			safeExecute(() => {
			let tries = 0;
			const iv = setInterval(() => {
					if (document.hidden) return;
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
						
						// Add cart button to item details (Mobile only)
						safeExecute(() => {
							const self = this;
							if (!this.$component) return;
							
							// Always remove existing cart button first
							this.$component.find('.item-cart-btn').remove();
							if (this.__posMobileCartCountInterval) {
								clearInterval(this.__posMobileCartCountInterval);
								this.__posMobileCartCountInterval = null;
							}
							
							// Only show this button on mobile screens
							const isMobile = (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) || (window.matchMedia && window.matchMedia(`(max-width: ${CONFIG.BREAKPOINTS.TABLET}px)`).matches);
							if (!isMobile) return;
							
							// Create cart button
							const cartBtn = $('<button class="item-cart-btn">');
							cartBtn.html(`${frappe._('Item Cart')} <span class="cart-count">0</span>`);
							
							// Update cart count
							const updateCartCount = () => {
								const frm = cur_pos && cur_pos.frm ? cur_pos.frm : (locals && locals.cur_frm ? locals.cur_frm : null);
								const doc = frm ? frm.doc : {};
								const total_qty = (doc?.items || []).reduce((acc, i) => acc + (parseFloat(i.qty) || 0), 0);
								cartBtn.find('.cart-count').text(total_qty);
							};
							updateCartCount();
							
							// Add click handler to return to checkout
							cartBtn.on('click', () => {
								self.toggle_component(false);
							});
							
							// Append to component
							this.$component.append(cartBtn);
							
							// Update count periodically
							this.__posMobileCartCountInterval = setInterval(updateCartCount, 500);
						}, 'addItemDetailsCartButton');
						
						// attach outside-click and input blur/change to finish edit and return
						safeExecute(() => {
							const self = this;
							const outsideHandler = function (e) {
								if (!self.$component || !self.$component.is(':visible')) return;
								const el = self.$component.get(0);
								if (el && !el.contains(e.target)) {
									self.toggle_component(false);
								}
							};
							const blurHandler = function (e) {
								// when inputs lose focus, close if click moved outside too (handled above)
							};
							const cartClickHandler = function () {
								// user clicked the cart area: close
								self.toggle_component(false);
							};
							this.__posMobileOutsideClickHandler = outsideHandler;
							document.addEventListener('mousedown', outsideHandler, true);
							document.addEventListener('touchstart', outsideHandler, { capture: true, passive: true });
							// optional: listen for blur on inputs
							this.$component && this.$component.find('input,select,textarea').on('blur.pos_mobile_edit', blurHandler);
							// listen for clicks on cart container
							const cart = document.querySelector('.customer-cart-container');
							this.__posMobileCartClickHandler = cartClickHandler;
							cart && cart.addEventListener('click', cartClickHandler, { capture: true });
						}, 'attachEditFinishListeners');
					}
					// When user finishes editing (details hidden), cleanup and return to checkout if needed
					if (!show) {
						// Always cleanup cart button and intervals
						safeExecute(() => {
							// Remove cart button
							this.$component && this.$component.find('.item-cart-btn').remove();
							
							// Clear cart count interval
							if (this.__posMobileCartCountInterval) {
								clearInterval(this.__posMobileCartCountInterval);
								this.__posMobileCartCountInterval = null;
							}
							
							// Detach listeners
							if (this.__posMobileOutsideClickHandler) {
								document.removeEventListener('mousedown', this.__posMobileOutsideClickHandler, true);
								document.removeEventListener('touchstart', this.__posMobileOutsideClickHandler, { capture: true });
								this.__posMobileOutsideClickHandler = null;
							}
							this.$component && this.$component.find('input,select,textarea').off('blur.pos_mobile_edit');
							const cart = document.querySelector('.customer-cart-container');
							if (cart && this.__posMobileCartClickHandler) {
								cart.removeEventListener('click', this.__posMobileCartClickHandler, { capture: true });
								this.__posMobileCartClickHandler = null;
							}
						}, 'detachEditFinishListeners');
						// Mobile: Auto-return to checkout after editing
						safeExecute(() => {
							const ctrl = window.cur_pos;
							const payment = ctrl && ctrl.payment;
							const isMobile = (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) || (window.matchMedia && window.matchMedia(`(max-width: ${CONFIG.BREAKPOINTS.TABLET}px)`).matches);
							
							if (payment && payment.__posMobileCanReturnToCheckout && isMobile) {
								payment.__posMobileCanReturnToCheckout = false;
								try {
									ctrl.cart && ctrl.cart.toggle_component(true);
									payment.toggle_component && payment.toggle_component(false);
									const cartEl = ctrl.cart && ctrl.cart.$component && ctrl.cart.$component.get(0);
									cartEl && strongScrollIntoView(cartEl);
									ctrl.cart && ctrl.cart.toggle_numpad && ctrl.cart.toggle_numpad(true);
									ctrl.cart && ctrl.cart.toggle_numpad_field_edit && ctrl.cart.toggle_numpad_field_edit('qty');
								} catch (e) {}
							}
						}, 'autoReturnToCheckout');
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
						this.__posMobileWasInCheckout = true;
						this.__posMobileCanReturnToCheckout = false;
						if (this._pos_mobile_refresh) clearInterval(this._pos_mobile_refresh);
						this._pos_mobile_refresh = setInterval(() => {
							safeExecute(() => {
								if (document.hidden) return;
								const doc = this.events.get_frm().doc;
								this.update_totals_section(doc);
								this.render_payment_mode_dom();
							}, 'paymentRefresh');
						}, 1000);
						safeExecute(() => { this.$component && strongScrollIntoView(this.$component.get(0)); }, 'paymentScroll');
					}, 'paymentCheckout');
				};

				// wrap edit_cart to mark intent to return to checkout after edits
				const orig_edit_cart = P.prototype.edit_cart;
				P.prototype.edit_cart = function () {
					if (this.__posMobileWasInCheckout) {
						this.__posMobileCanReturnToCheckout = true;
					}
					orig_edit_cart && orig_edit_cart.call(this);
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

		// Mobile: tap on quantity in cart increments qty without opening item details
		safeExecute(() => {
			const isMobile = (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) || (window.matchMedia && window.matchMedia(`(max-width: ${CONFIG.BREAKPOINTS.TABLET}px)`).matches);
			if (!isMobile) return;
			
			const container = document.querySelector('.customer-cart-container');
			if (!container) return;
			
			container.addEventListener('click', function (e) {
				const qtyEl = e.target && e.target.closest && e.target.closest('.item-qty');
				if (!qtyEl) return;
				
				e.preventDefault();
				e.stopPropagation();
				
				const wrapper = qtyEl.closest('.cart-item-wrapper');
				if (!wrapper) return;
				
				const rowName = unescape(wrapper.getAttribute('data-row-name') || '');
				const ctrl = window.cur_pos;
				const frm = ctrl && ctrl.frm;
				if (!frm || !rowName) return;
				
				const itemRow = (frm.doc.items || []).find(i => i.name === rowName);
				if (!itemRow) return;
				
				const newQty = (parseFloat(itemRow.qty) || 0) + 1;
				ctrl.on_cart_update({ field: 'qty', value: newQty, item: { name: rowName } }).then(() => {
					try { 
						ctrl.cart.toggle_numpad(true); 
						ctrl.cart.toggle_numpad_field_edit('qty'); 
					} catch (err) {}
				});
			}, true);
		}, 'mobileQtyTapIncrement');

		// Intercept "Complete Order" button to force auto-submit without confirmation
		safeExecute(() => {
			let handlerAttached = false;
			const attach = () => {
				if (handlerAttached) return;
				const container = document.querySelector(CONFIG.CLASSES.PAYMENT_CONTAINER);
				if (!container) return;
			document.addEventListener('click', function onClick(e) {
					const btn = e.target && (e.target.closest && e.target.closest('.payment-container .submit-order-btn'));
					if (!btn) return;
					// Stop the original handler (which triggers savesubmit confirmation)
					e.preventDefault();
					e.stopImmediatePropagation();
					const ctrl = window.cur_pos;
					const frm = ctrl && ctrl.frm;
					if (!frm) return;
					// Run basic validations similar to core
					const doc = frm.doc || {};
					const has_items = Array.isArray(doc.items) && doc.items.length > 0;
					if (!has_items) {
						frappe.show_alert({ message: frappe._('You cannot submit empty order.'), indicator: 'orange' });
						frappe.utils.play_sound('error');
						return;
					}
					// Submit without confirmation
					frm.save('Submit', (r) => {
						if (!r || r.exc) return;
						try {
							ctrl.toggle_components(false);
							ctrl.order_summary.toggle_component(true);
							ctrl.order_summary.load_summary_of(frm.doc, true);
						} catch (err) { /* no-op */ }
						frappe.show_alert({
							indicator: 'green',
							message: frappe._('POS invoice {0} created successfully').replace('{0}', (r.doc && r.doc.name) || frm.doc.name || '')
						});
					});
				}, true);
				handlerAttached = true;
			};
			// try now and after slight delay for late renders
			attach();
			setTimeout(attach, CONFIG.TIMING.RETRY_DELAY);
		}, 'interceptCompleteOrder');
	});

	// Expose minimal API for debugging
	window.POSMobile = {
		config: CONFIG,
		scrollToView: strongScrollIntoView
	};

})();
