// pos_overrides.js
// Loads only on the Point of Sale page via hooks.page_js
// Keep everything idempotent and scoped.

(function () {
    if (!window.frappe) return;

    // Stronger smooth scroll helper to ensure element is in view after layout settles
    function strongScrollIntoView(element) {
        try {
            const el = element && element.jquery ? element.get(0) : element;
            if (!el) return;
            const doScroll = () => el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (window.requestAnimationFrame) {
                requestAnimationFrame(() => {
                    doScroll();
                    setTimeout(doScroll, 120);
                });
            } else {
                doScroll();
                setTimeout(doScroll, 120);
            }
        } catch (e) {}
    }

	function onPOSReady(cb) {
		// Wait until the POS page main container is present
		const check = setInterval(() => {
			const container = document.querySelector('.point-of-sale-app') || document.querySelector('.payment-container');
			if (container) {
				clearInterval(check);
				cb();
			}
		}, 300);
	}

	function injectStylesOnce() {
		const id = 'pos-mobile-plus-styles';
		if (document.getElementById(id)) return;
		const style = document.createElement('style');
		style.id = id;
		style.textContent = `
			/* Modernize payment cards and totals on both desktop and mobile */
			.payment-container .submit-order-btn { position: static; width: 100%; height: 48px; display: flex; align-items: center; justify-content: center; background: var(--btn-primary); color: var(--neutral); border-radius: var(--border-radius-md); margin-top: var(--padding-sm); transition: transform .08s ease, filter .16s ease; }
			.payment-container .submit-order-btn:active { transform: translateY(1px); filter: brightness(.95); }
			.payment-container .payment-modes { display: grid; grid-gap: 10px; }
			@media (max-width: 480px) { .payment-container .payment-modes { grid-template-columns: 1fr; } }
			@media (min-width: 481px) and (max-width: 768px) { .payment-container .payment-modes { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
			.payment-container .payment-mode-wrapper { margin: 0; }
			.payment-container .mode-of-payment { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: var(--border-radius-md); border: 1px solid var(--border-color); background: var(--bg-color); box-shadow: 0 1px 2px rgba(0,0,0,.05); transition: box-shadow .2s ease, border-color .2s ease, background .2s ease; }
			.payment-container .mode-of-payment:hover { box-shadow: 0 2px 6px rgba(0,0,0,.06); }
			.payment-container .mode-of-payment.border-primary { border-color: var(--btn-primary); background: linear-gradient(0deg, rgba(0, 122, 255, .06), rgba(0,122,255,.06)); box-shadow: 0 0 0 1px rgba(0, 122, 255, .18) inset, 0 2px 6px rgba(0,0,0,.06); }
			.payment-container .mode-of-payment.border-primary::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--btn-primary); opacity: .9; }
			.payment-container .mode-of-payment .pay-amount { margin-left: auto; font-weight: 600; }
			.payment-container .number-pad .numpad-btn { height: 56px; font-size: 18px; border-radius: var(--border-radius-md); box-shadow: 0 1px 1px rgba(0,0,0,.04); }
			.payment-container .number-pad .numpad-btn:active { transform: translateY(1px); }
			.payment-container .number-pad { gap: 10px; }
			.payment-container .totals-section { margin-top: 10px; }
			.payment-container .totals-section .totals { display: grid; grid-gap: 10px; }
			@media (max-width: 480px) { .payment-container .totals-section .totals { grid-template-columns: 1fr; } }
			@media (min-width: 481px) and (max-width: 768px) { .payment-container .totals-section .totals { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
			.payment-container .totals-section .totals .col { background: var(--bg-color); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); padding: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.06); display: flex; flex-direction: column; gap: 4px; }
			.payment-container .totals-section .totals .total-label { font-size: 12px; color: var(--text-muted); }
			.payment-container .totals-section .totals .value { font-weight: 700; }
			.payment-container .totals-section .totals .grand-total .value { color: var(--orange-600, #c05621); }
			.payment-container .totals-section .totals .paid-amount .value { color: var(--blue-600, #2563eb); }
			.payment-container .totals-section .totals .remaining-amount .value.text-danger { color: var(--red-600, #dc2626); }
			.payment-container .totals-section .totals .remaining-amount .value.text-success { color: var(--green-600, #16a34a); }
			@media (max-width: 768px) { .payment-container .totals-section .seperator-y { display: none; } }

			/* Cart totals: keep checkout visible */
			.customer-cart-container .cart-totals-section { position: sticky; bottom: 0; background: var(--bg-color); z-index: 1; }

			/* Item Selector responsive grid and filter bar wrapping */
			.items-selector .filter-section { display: flex !important; flex-wrap: wrap !important; gap: 8px; }
			.items-selector .view-selected-wrapper { flex: 0 0 100% !important; width: 100% !important; min-width: 100% !important; display: flex; align-items: center; margin-top: 8px; order: 99; }
			.items-selector .items-container { display: grid; grid-gap: var(--padding-sm); }
			@media (max-width: 420px) { .items-selector .items-container { grid-template-columns: repeat(2, minmax(0,1fr)); } }
			@media (min-width: 421px) and (max-width: 640px) { .items-selector .items-container { grid-template-columns: repeat(3, minmax(0,1fr)); } }
			@media (min-width: 641px) and (max-width: 900px) { .items-selector .items-container { grid-template-columns: repeat(4, minmax(0,1fr)); } }
			@media (min-width: 901px) { .items-selector .items-container { grid-template-columns: repeat(5, minmax(0,1fr)); } }

			/* Selected Items button pulse (mobile) */
			@keyframes posBtnPulse { 0% { box-shadow: 0 0 0 0 rgba(0, 122, 255, .35);} 70% { box-shadow: 0 0 0 8px rgba(0, 122, 255, 0);} 100% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0);} }
			.items-selector .selected-items-btn { width: 100% !important; height: 36px; padding: 0 12px; font-size: 16px; border: none; border-radius: var(--border-radius-md); background: #000000ff; color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08); animation: posBtnPulse 2s ease-out infinite; }
			@media (max-width: 768px) { .items-selector .selected-items-btn { display: flex !important; justify-content: center; align-items: center; } }
			@media (min-width: 769px) { .items-selector .selected-items-btn { display: none; } }
		`;
		document.body.appendChild(style);
	}

	function enhanceAccessibility() {
		try {
			const totals = document.querySelector('.payment-container .totals');
			totals && totals.setAttribute('role', 'region');
			totals && totals.setAttribute('aria-live', 'polite');
			totals && totals.setAttribute('aria-label', frappe._('Payment totals'));

			// Update item cart label with count
			const updateCartButtonCount = () => {
				try {
					const frm = cur_pos && cur_pos.frm ? cur_pos.frm : (locals && locals.cur_frm ? locals.cur_frm : null);
					const doc = frm ? frm.doc : {};
					const total_qty = (doc?.items || []).reduce((acc, i) => acc + flt(i.qty || 0), 0);
					const btn = document.querySelector('.items-selector .selected-items-btn');
					if (btn) {
						const baseLabel = frappe._('Item Cart');
						btn.textContent = total_qty > 0 ? `${baseLabel} (${total_qty})` : baseLabel;
					}
				} catch (e) {}
			};
			// Observe doc refreshes by polling lightly
			setInterval(updateCartButtonCount, 1500);
		} catch (e) {}
	}

	function addViewSelectedItemsButton() {
		try {
			const filter = document.querySelector('.items-selector .filter-section');
			const cartContainer = document.querySelector('.customer-cart-container');
			if (!filter || !cartContainer) return;

			// Use existing button if present; otherwise create
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

			// Force wrapper to full width on mobile flex rows; prevent shrinking
			if (wrapper) {
				wrapper.style.cssText = 'flex: 0 0 100% !important; width:100% !important; min-width:100%; margin-left:0; display:flex; align-items:center; margin-top:8px;';
			}

			// Ensure button full width and mobile-friendly
			btn.style.cssText = 'display:none; flex: 0 0 100%; width:100% !important; height:36px; padding:0 12px; font-size:16px; border:none; border-radius:var(--border-radius-md); background:#000000ff; color:#fff; box-shadow:0 1px 2px rgba(0,0,0,.08); box-sizing:border-box;';

			// Initialize label with total selected count (if available)
			try {
				const frm = cur_pos && cur_pos.frm ? cur_pos.frm : (locals && locals.cur_frm ? locals.cur_frm : null);
				const doc = frm ? frm.doc : {};
				const total_qty = (doc?.items || []).reduce((acc, i) => acc + (parseFloat(i.qty) || 0), 0);
				const baseLabel = frappe._('Item Cart');
				btn.textContent = total_qty > 0 ? `${baseLabel} (${total_qty})` : baseLabel;
			} catch (e) {
				btn.textContent = frappe._('Item Cart');
			}

			// Toggle visibility based on viewport to mirror core behavior
			const updateBtnVisibility = () => {
				try {
					const isMobile = (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) || (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
					if (isMobile) {
						btn.style.display = 'flex';
						btn.style.alignItems = 'center';
						btn.style.justifyContent = 'center';
					} else {
						btn.style.display = 'none';
					}
				} catch (e) {}
			};
			updateBtnVisibility();
			window.addEventListener('resize', updateBtnVisibility);

			btn.addEventListener('click', () => strongScrollIntoView(cartContainer));
		} catch (e) {}
	}

	onPOSReady(() => {
		injectStylesOnce();
		enhanceAccessibility();
		addViewSelectedItemsButton();

		// Retry until the item selector renders to avoid timing/layout issues
		try {
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
			}, 600);
		} catch (e) {}

		// Monkey-patch POS Controller bits we customized in core, but now via app override
		try {
			if (erpnext && erpnext.PointOfSale && erpnext.PointOfSale.Controller) {
				const C = erpnext.PointOfSale.Controller;
				if (!C.__posMobilePatched) {
					C.__posMobilePatched = true;
					const orig_update_cart_html = C.prototype.update_cart_html;
					C.prototype.update_cart_html = function (item_row, remove_item) {
						// call original
						orig_update_cart_html && orig_update_cart_html.call(this, item_row, remove_item);
						// refresh item selector badges if available (mirrors our core edit)
						try {
							if (this.item_selector && typeof this.item_selector.update_cart_badges === 'function') {
								this.item_selector.update_cart_badges();
							}
						} catch (e) {}
					};

					// Optional: smooth-scroll helper on component show (kept subtle)
					const orig_toggle_components = C.prototype.toggle_components;
					C.prototype.toggle_components = function (show) {
						orig_toggle_components && orig_toggle_components.call(this, show);
                        if (show) {
                            try { this.$components_wrapper && strongScrollIntoView(this.$components_wrapper.get(0)); } catch (e) {}
                        }
					};
				}
			}
		} catch (e) {}

		// Patch ItemDetails.toggle_component to smooth-scroll on show
		try {
			if (erpnext?.PointOfSale?.ItemDetails && !erpnext.PointOfSale.ItemDetails.__posMobilePatched) {
				erpnext.PointOfSale.ItemDetails.__posMobilePatched = true;
				const ID = erpnext.PointOfSale.ItemDetails;
				const orig_toggle = ID.prototype.toggle_component;
				ID.prototype.toggle_component = function (show) {
					orig_toggle && orig_toggle.call(this, show);
                    if (show) {
                        try { this.$component && strongScrollIntoView(this.$component.get(0)); } catch (e) {}
                    }
				};
			}
		} catch (e) {}

		// Observe customer selection to auto-scroll to items
		try {
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
		} catch (e) {}

		// Patch Payment behaviors: auto-refresh during checkout, a11y, and key mapping
		try {
			if (erpnext?.PointOfSale?.Payment && !erpnext.PointOfSale.Payment.__posMobilePatched) {
				erpnext.PointOfSale.Payment.__posMobilePatched = true;
				const P = erpnext.PointOfSale.Payment;

				// Wrap bind_events to enhance accessibility and keyboard mapping
				const orig_bind = P.prototype.bind_events;
				P.prototype.bind_events = function () {
					orig_bind && orig_bind.call(this);
					// a11y: mark selected/unselected visually for assistive tech
					try {
						this.$payment_modes.off('click.pos_mobile_a11y').on('click.pos_mobile_a11y', '.mode-of-payment', (e) => {
							const $clicked = $(e.currentTarget);
							$clicked.attr('aria-selected', 'true').attr('role', 'button');
							$clicked.parent().siblings().find('.mode-of-payment').attr('aria-selected', 'false');
						});
					} catch (e) {}

					// Keyboard enhancement: map Delete to Backspace for numpad delete
					try {
						$(document).off('keydown.pos_mobile_delete').on('keydown.pos_mobile_delete', (e) => {
							if (!this.$component.is(':visible')) return;
							if (!this.selected_mode) return;
							const key = (e.key === 'Delete') ? 'Backspace' : e.key;
							if (key !== e.key) {
								this.on_numpad_clicked(key, false);
								e.preventDefault();
							}
						});
					} catch (e) {}
				};

				// Auto-refresh while payment panel is open
				const orig_checkout = P.prototype.checkout;
				P.prototype.checkout = function () {
					orig_checkout && orig_checkout.call(this);
					try {
						if (this._pos_mobile_refresh) clearInterval(this._pos_mobile_refresh);
						this._pos_mobile_refresh = setInterval(() => {
							try {
								const doc = this.events.get_frm().doc;
								this.update_totals_section(doc);
								this.render_payment_mode_dom();
							} catch (e) {}
						}, 1000);
                        // ensure payment panel is in view
                        try { this.$component && strongScrollIntoView(this.$component.get(0)); } catch (e) {}
					} catch (e) {}
				};

				// Stop refresh when hidden
				const orig_toggle_pay = P.prototype.toggle_component;
				P.prototype.toggle_component = function (show) {
					orig_toggle_pay && orig_toggle_pay.call(this, show);
					if (!show && this._pos_mobile_refresh) {
						clearInterval(this._pos_mobile_refresh);
						this._pos_mobile_refresh = null;
					}
				};
			}
		} catch (e) {}

		// Provide update_cart_badges on ItemSelector if missing, and keep badges in sync
		try {
			const IS = erpnext?.PointOfSale?.ItemSelector;
			if (IS && !IS.prototype.update_cart_badges) {
				IS.prototype.update_cart_badges = function () {
					try {
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
								badge.style.cssText = 'position:absolute;top:6px;right:6px;min-width:20px;height:20px;border-radius:10px;background:var(--btn-primary);color:var(--neutral);font-size:12px;line-height:20px;text-align:center;padding:0 6px;display:none;';
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

						// Update mobile Item Cart button count
						const btn = document.querySelector('.items-selector .selected-items-btn');
						if (btn) {
							const total_qty = items.reduce((acc, i) => acc + (parseFloat(i.qty) || 0), 0);
							const baseLabel = frappe._('Item Cart');
							btn.textContent = total_qty > 0 ? `${baseLabel} (${total_qty})` : baseLabel;
						}
					} catch (e) {}
				};
				// Keep badges updated periodically as a safety net
				setInterval(() => {
					try {
						const selector = cur_pos?.item_selector;
						selector && selector.update_cart_badges && selector.update_cart_badges();
					} catch (e) {}
				}, 1500);
			}
		} catch (e) {}
	});
})();
