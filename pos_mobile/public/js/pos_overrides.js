// pos_overrides.js
// Refactored POS Mobile enhancements with improved architecture
// Loads only on the Point of Sale page via hooks.page_js
// Keep everything idempotent and scoped.

(function () {
	console.log('[POS Mobile] Starting initialization...');

	if (!window.frappe) {
		console.error('[POS Mobile] ERROR: Frappe framework not found!');
		return;
	}

	console.log('[POS Mobile] Frappe framework detected');

	// Configuration and constants
	const CONFIG = {
		// enable lightweight debug logs for lifecycle events (timers/cleanup)
		DEBUG: false,
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
			TOTALS_SECTION: '.totals-section'
		},
		BREAKPOINTS: {
			MOBILE: 480,
			TABLET: 768,
			DESKTOP: 901,
			XS: 0,
			SM: 576,
			MD: 768,
			LG: 992,
			XL: 1200,
			XXL: 1400
		},
		STOCK: {
			REFRESH_MS: 30000,
			BATCH_SIZE: 30
		},
		QUEUE: {
			FLUSH_INTERVAL_MS: 5000,
			BATCH_SIZE: 10,
			BACKOFF_BASE_MS: 3000,
			BACKOFF_MAX_MS: 60000
		},
		SYNC: {
			REMOTE_DB_URL: null, /* e.g., 'https://user:pass@local-couchdb:5984/pos_sync' */
			REMOTE_METHOD: 'pos_mobile.pos_mobile.api.pos_sync.submit_sale',
			REMOTE_UPDATE_METHOD: 'pos_mobile.pos_mobile.api.pos_sync.mark_paid'
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

	// Unified mobile detection
	function isMobile() {
		try {
			if (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) return true;
			if (window.matchMedia && window.matchMedia(`(max-width: ${CONFIG.BREAKPOINTS.TABLET}px)`).matches) return true;
		} catch (e) { }
		return false;
	}

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

	// Lightweight debounce utility to reduce resize/event thrash
	function debounce(fn, wait) {
		let t;
		return function debounced() {
			const ctx = this, args = arguments;
			clearTimeout(t);
			t = setTimeout(() => fn.apply(ctx, args), wait);
		};
	}

	// Minimal IndexedDB helpers for POS caches
	const IDB = {
		_openPromises: {},
		open(dbName = 'pos_mobile', version = 1) {
			const key = `${dbName}::${version}`;
			if (this._openPromises[key]) return this._openPromises[key];
			this._openPromises[key] = new Promise((resolve, reject) => {
				const req = indexedDB.open(dbName, version);
				req.onupgradeneeded = function (e) {
					const db = req.result;
					if (!db.objectStoreNames.contains('stock')) {
						const s = db.createObjectStore('stock', { keyPath: 'item_code' });
						s.createIndex('updated_at', 'updated_at');
					}
					if (!db.objectStoreNames.contains('orders')) {
						db.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
					}
					if (!db.objectStoreNames.contains('meta')) {
						db.createObjectStore('meta', { keyPath: 'key' });
					}
				};
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			}).catch(err => { delete this._openPromises[key]; throw err; });
			return this._openPromises[key];
		},
		put(store, value) {
			return this.open().then(db => new Promise((resolve, reject) => {
				const tx = db.transaction(store, 'readwrite');
				tx.objectStore(store).put(value);
				tx.oncomplete = () => resolve(true);
				tx.onerror = () => reject(tx.error);
			}));
		},
		get(store, key) {
			return this.open().then(db => new Promise((resolve, reject) => {
				const tx = db.transaction(store, 'readonly');
				const req = tx.objectStore(store).get(key);
				req.onsuccess = () => resolve(req.result || null);
				req.onerror = () => reject(req.error);
			}));
		},
		bulkGet(store, keys) {
			return Promise.all(keys.map(k => this.get(store, k)));
		}
	};

	// track global intervals/observers for cleanup
	const GLOBAL_INTERVALS = [];
	const GLOBAL_OBSERVERS = [];

	// Safe data-attribute reader (avoids deprecated unescape and normalizes to string)
	function readDataAttr(element, attributeName) {
		return safeExecute(() => {
			if (!element || typeof element.getAttribute !== 'function') return '';
			const value = element.getAttribute(attributeName);
			return typeof value === 'string' ? value : '';
		}, 'readDataAttr', '');
	}

	// Helper to safely get current form (centralized)
	function getCurFrm() {
		try {
			return (window.cur_pos && window.cur_pos.frm) || (typeof locals !== 'undefined' && locals && locals.cur_frm) || null;
		} catch (e) { return null; }
	}

	// Register site-scoped service worker for offline navigation (idempotent)
	(function registerSiteSW() {
		if (!('serviceWorker' in navigator)) return;
		// Already registered by another script?
		if (navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL && navigator.serviceWorker.controller.scriptURL.endsWith('/sw.js')) {
			if (CONFIG.DEBUG) console.log('[POS Mobile] Site SW already controlling this page');
			return;
		}
		try {
			navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
				if (CONFIG.DEBUG) console.log('[POS Mobile] Registered site service worker', reg);
			}).catch(err => {
				console.warn('[POS Mobile] Failed to register site SW:', err);
			});
		} catch (e) {
			// older browsers or CSP restrictions
			if (CONFIG.DEBUG) console.warn('[POS Mobile] SW registration skipped:', e);
		}
	})();

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
			/* Typography and spacing */
			.point-of-sale-app { --pos-font-size: 14px; --pos-line-height: 1.35; }
			.point-of-sale-app, .point-of-sale-app * { font-size: var(--pos-font-size); line-height: var(--pos-line-height); }
			.point-of-sale-app h1, .point-of-sale-app h2, .point-of-sale-app h3 { letter-spacing: -0.01em; }
			.point-of-sale-app .section-head, .point-of-sale-app .grid-heading { font-weight: 600; }
			.point-of-sale-app .container.page-body { gap: 12px; }

			/* Buttons palette */
			.point-of-sale-app .btn, .point-of-sale-app .btn-primary { border-radius: var(--border-radius-md); font-weight: 600; }
			.point-of-sale-app .btn-primary { background: var(--btn-primary); color: var(--neutral); border-color: var(--btn-primary); }
			.point-of-sale-app .btn-primary:hover { filter: brightness(0.96); transform: translateY(-1px); }
			.point-of-sale-app .btn-primary:active { transform: translateY(0); }

			/* Focus visible */
			.point-of-sale-app :focus-visible { outline: 2px solid var(--blue-500, #3b82f6); outline-offset: 2px; border-radius: 6px; }

			/* Empty states */
			.point-of-sale-app .empty-hint { color: var(--text-muted); font-size: 13px; padding: 12px; text-align: center; }

			/* Light animations */
			.point-of-sale-app .fade-in { animation: posFadeIn .2s ease-out; }
			@keyframes posFadeIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
			/*
			Responsive layout rules for POS across standard breakpoints
			- xs (< ${CONFIG.BREAKPOINTS.SM}px): stacked, compact
			- sm (>= ${CONFIG.BREAKPOINTS.SM}px): possible two-columns
			- md (>= ${CONFIG.BREAKPOINTS.MD}px): split layout with sidebars
			- lg (>= ${CONFIG.BREAKPOINTS.LG}px): multi-column comfortable spacing
			- xl (>= ${CONFIG.BREAKPOINTS.XL}px): max content width tuning
			- xxl (>= ${CONFIG.BREAKPOINTS.XXL}px): centered wide layout
			*/
			/* xs: default (stacked, compact) */
			.point-of-sale-app { --pos-max-width: 100%; }
			.point-of-sale-app .container.page-body { padding: 8px 8px; }
			.items-selector .items-container { grid-template-columns: repeat(2, minmax(0,1fr)); }
			.payment-container .payment-modes { grid-template-columns: 1fr; }

			/* sm: >=576px */
			@media (min-width: ${CONFIG.BREAKPOINTS.SM}px) {
				.items-selector .items-container { grid-template-columns: repeat(3, minmax(0,1fr)); }
				.point-of-sale-app .container.page-body { padding: 12px 12px; }
			}

			/* md: >=768px */
			@media (min-width: ${CONFIG.BREAKPOINTS.MD}px) {
				.items-selector .items-container { grid-template-columns: repeat(4, minmax(0,1fr)); }
				.point-of-sale-app .container.page-body { padding: 16px 16px; }
				.point-of-sale-app .layout-main-section { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 16px; align-items: start; }
			}

			/* lg: >=992px */
			@media (min-width: ${CONFIG.BREAKPOINTS.LG}px) {
				.items-selector .items-container { grid-template-columns: repeat(5, minmax(0,1fr)); }
				.point-of-sale-app .container.page-body { padding: 20px 20px; }
				.point-of-sale-app .layout-main-section { grid-template-columns: 1.2fr 0.8fr; gap: 20px; }

				/* comfortable tap targets */
				.payment-container .number-pad .numpad-btn { height: 60px; font-size: 18px; }
			}

			/* xl: >=1200px */
			@media (min-width: ${CONFIG.BREAKPOINTS.XL}px) {
				.point-of-sale-app { --pos-max-width: 1140px; margin: 0 auto; }
				.items-selector .items-container { grid-template-columns: repeat(6, minmax(0,1fr)); }
				.point-of-sale-app .layout-main-section { grid-template-columns: 1.25fr 0.75fr; gap: 24px; }
			}

			/* xxl: >=1400px */
			@media (min-width: ${CONFIG.BREAKPOINTS.XXL}px) {
				.point-of-sale-app { --pos-max-width: 1320px; margin-left: auto; margin-right: auto; }
				.items-selector .items-container { grid-template-columns: repeat(7, minmax(0,1fr)); }
				.point-of-sale-app .layout-main-section { grid-template-columns: 1.3fr 0.7fr; gap: 28px; }
			}
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
			/* Receipt buttons styling */
			.email-btn { background: var(--blue-600,rgb(17, 70, 128)) !important; color: white !important; border: none !important; border-radius: var(--border-radius-md, 6px) !important; padding: 8px 16px !important; font-weight: 500 !important; transition: all 0.2s ease !important; }
			.email-btn:hover { background: var(--blue-700,rgb(17, 70, 128)) !important; transform: translateY(-1px) !important; box-shadow: 0 4px 8px rgba(37, 99, 235, 0.3) !important; }
			.email-btn:active { transform: translateY(0) !important; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2) !important; }
			.print-btn { background: var(--green-600,rgb(210, 83, 47)) !important; color: white !important; border: none !important; border-radius: var(--border-radius-md, 6px) !important; padding: 8px 16px !important; font-weight: 500 !important; transition: all 0.2s ease !important; }
			.print-btn:hover { background: var(--green-700,rgb(210, 83, 47)) !important; transform: translateY(-1px) !important; box-shadow: 0 4px 8px rgba(22, 163, 74, 0.3) !important; }
			.print-btn:active { transform: translateY(0) !important; box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2) !important; }
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

			/* Top-left per-item count button (visible on all screen sizes) */
			.item-count-btn { position: absolute; top: 6px; left: 6px; min-width: 20px; height: 20px; border-radius: 10px; background: var(--btn-primary); color: var(--neutral); font-size: 12px; line-height: 20px; text-align: center; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; z-index: 10; cursor: pointer; user-select: none; }
			.item-count-btn[aria-hidden="true"] { opacity: 0.6; }
			.item-wrapper { position: relative; }
			/* Show stock tile controls only on desktop */
			@media (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) { .items-selector .stock-container { display: none !important; } }
			@media (min-width: ${CONFIG.BREAKPOINTS.TABLET + 1}px) { .items-selector .stock-container { display: flex !important; } }
			/* Item Details Cart Button - Mobile Only */
			@media (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) {
				.item-details-container .item-cart-btn { position: sticky; bottom: 0; width: 100%; height: 48px; margin-top: 16px; background: var(--btn-primary); color: var(--neutral); border: none; border-radius: var(--border-radius-md); font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,.15); z-index: 10; }
				.item-details-container .item-cart-btn:active { transform: translateY(1px); filter: brightness(.95); }
				.item-details-container .item-cart-btn .cart-count { margin-left: 8px; background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 12px; font-size: 14px; }
			}
			@media (min-width: ${CONFIG.BREAKPOINTS.TABLET + 1}px) {
				.item-details-container .item-cart-btn { display: none !important; }
			}

			/* Hide New Invoice button on mobile */
			@media (max-width: ${CONFIG.BREAKPOINTS.TABLET}px) {
				.point-of-sale-app > .past-order-summary .new-btn { display: none !important; }
			}

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
				body.pos-mobile-active .page-head .page-actions .primary-action { display: inline-flex !important; }
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
			// Offline badge (top-right)
			(function injectOfflineBadge() {
				const id = 'pos-offline-badge';
				if (document.getElementById(id)) return;
				const badge = document.createElement('div');
				badge.id = id;
				badge.setAttribute('role', 'status');
				badge.setAttribute('aria-live', 'polite');
				badge.style.cssText = 'display:none;position:fixed;top:10px;right:10px;z-index:3000;background:#dc2626;color:#fff;padding:6px 10px;border-radius:9999px;font-weight:600;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
				badge.textContent = frappe._('Offline');
				document.body.appendChild(badge);

				const update = () => {
					if (navigator.onLine) {
						badge.style.display = 'none';
					} else {
						badge.style.display = 'inline-flex';
					}
				};
				window.addEventListener('online', update, { passive: true });
				window.addEventListener('offline', update, { passive: true });
				update();
			})();
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
			if (!isMobile()) return;
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
					if (isMobile()) {
						btn.style.display = 'flex';
						btn.style.alignItems = 'center';
						btn.style.justifyContent = 'center';
					} else {
						btn.style.display = 'none';
					}
				}, 'updateBtnVisibility');
			};
			updateBtnVisibility();
			window.addEventListener('resize', debounce(updateBtnVisibility, 150), { passive: true });

			btn.addEventListener('click', () => strongScrollIntoView(cartContainer));
		}, 'addViewSelectedItemsButton');
	}


	// Main init
	onPOSReady(() => {
		console.log('[POS Mobile] POS container detected - initializing features...');

		// mark body so header tweaks are scoped to POS only
		try { document.body.classList.add('pos-mobile-active'); } catch (e) { }
		injectStylesOnce();
		console.log('[POS Mobile] Styles injected');

		enhanceAccessibility();
		console.log('[POS Mobile] Accessibility enhanced');

		addViewSelectedItemsButton();
		console.log('[POS Mobile] Item cart button added');

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
			// track interval for cleanup
			GLOBAL_INTERVALS.push(iv);
		}, 'retryItemSelector');

		// Online stock refresher: periodically cache visible item stock
		safeExecute(() => {
			let lastRun = 0;
			const fetchAndCacheStock = () => {
				if (!navigator.onLine) return;
				const now = Date.now();
				if (now - lastRun < CONFIG.STOCK.REFRESH_MS) return;
				lastRun = now;
				const tiles = Array.from(document.querySelectorAll('.items-selector .item-wrapper'));
				const codes = tiles.slice(0, CONFIG.STOCK.BATCH_SIZE).map(t => readDataAttr(t, 'data-item-code')).filter(Boolean);
				if (!codes.length) return;
				try {
					frappe.call({
						method: 'pos_mobile.pos_mobile.api.pos_stock.get_available_qty',
						args: () => {
							const ctrl = window.cur_pos;
							const frm = ctrl && ctrl.frm;
							const profile = frm && frm.doc && frm.doc.pos_profile;
							return { item_codes: codes, pos_profile: profile || undefined };
						},
						freeze: false
					}).then(r => {
						const data = r && r.message ? r.message : {};
						Object.keys(data).forEach(item_code => {
							IDB.put('stock', {
								item_code,
								actual_qty: Number(data[item_code] && data[item_code].actual_qty) || 0,
								updated_at: Date.now()
							}).catch(() => { });
						});
					}).catch(() => { });
				} catch (e) { }
			};
			// run on load and on interval
			const stockInterval = setInterval(() => { if (document.hidden) return; fetchAndCacheStock(); }, 5000);
			window.POSMobile.stockRefreshInterval = stockInterval;
			GLOBAL_INTERVALS.push(stockInterval);
			window.addEventListener('online', fetchAndCacheStock, { passive: true });
			fetchAndCacheStock();
		}, 'onlineStockRefresh');

		// Observe DOM for late renders and ensure Item Cart button exists
		safeExecute(() => {
			let ensured = false;
			const ensureBtn = () => {
				const filter = document.querySelector('.items-selector .filter-section');
				if (!filter) return false;
				const hasBtn = filter.querySelector('.selected-items-btn');
				const onMobile = isMobile();
				if (!onMobile) {
					if (hasBtn) {
						const wrapper = hasBtn.closest('.view-selected-wrapper');
						if (wrapper && wrapper.parentNode) { wrapper.parentNode.removeChild(wrapper); }
					}
					return true;
				}
				if (!hasBtn) {
					addViewSelectedItemsButton();
					return false;
				}
				return true;
			};
			if (ensureBtn()) return;
			const mo = new MutationObserver(() => {
				try {
					if (document.hidden) return;
					if (ensureBtn()) { mo.disconnect(); ensured = true; }
				} catch (e) { }
			});
			mo.observe(document.body, { childList: true, subtree: true });
			// safety timeout to disconnect after some time
			setTimeout(() => { try { if (!ensured) mo.disconnect(); } catch (e) { } }, 10000);
		}, 'observeItemCartButton');

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
							if (!isMobile()) return;

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
							GLOBAL_INTERVALS.push(this.__posMobileCartCountInterval);
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
						// Mobile: Auto-return to checkout after editing (NOT payment)
						safeExecute(() => {
							const ctrl = window.cur_pos;
							const payment = ctrl && ctrl.payment;
							const isMobile = (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) || (window.matchMedia && window.matchMedia(`(max-width: ${CONFIG.BREAKPOINTS.TABLET}px)`).matches);

							if (payment && payment.__posMobileCanReturnToCheckout && isMobile) {
								payment.__posMobileCanReturnToCheckout = false;
								try {
									// Show cart (checkout) section, hide payment section
									ctrl.cart && ctrl.cart.toggle_component(true);
									payment.toggle_component && payment.toggle_component(false);

									// Scroll to cart/checkout section
									const cartEl = ctrl.cart && ctrl.cart.$component && ctrl.cart.$component.get(0);
									cartEl && strongScrollIntoView(cartEl);

									// Show numpad for quantity editing
									ctrl.cart && ctrl.cart.toggle_numpad && ctrl.cart.toggle_numpad(true);
									ctrl.cart && ctrl.cart.toggle_numpad_field_edit && ctrl.cart.toggle_numpad_field_edit('qty');
								} catch (e) { }
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
						// Ensure Item Cart button exists and is visible on mobile only
						try {
							addViewSelectedItemsButton();
							const filter = document.querySelector('.items-selector .filter-section');
							const btn = filter && filter.querySelector('.selected-items-btn');
							const onMobile = (erpnext?.PointOfSale?.Utils?.isMobile && erpnext.PointOfSale.Utils.isMobile()) || (window.matchMedia && window.matchMedia(`(max-width: ${CONFIG.BREAKPOINTS.TABLET}px)`).matches);
							if (btn) {
								if (onMobile) {
									btn.style.display = 'flex';
									btn.style.alignItems = 'center';
									btn.style.justifyContent = 'center';
								} else {
									btn.style.display = 'none';
								}
							}
						} catch (e) { }
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

		// // Provide update_cart_badges + periodic sync
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
							const code = readDataAttr(tile, 'data-item-code');
							const uom = readDataAttr(tile, 'data-uom');
							const qty = items.filter((i) => i.item_code === code && (!uom || i.uom === uom)).reduce((acc, i) => acc + (parseFloat(i.qty) || 0), 0);

							// ensure tile cache container
							tile.__posRefs = tile.__posRefs || {};

							// Count button caching
							let countBtn = tile.__posRefs.countBtn;
							if (!countBtn) {
								countBtn = tile.querySelector('.item-count-btn');
								if (!countBtn) {
									countBtn = document.createElement('button');
									countBtn.className = 'item-count-btn';
									countBtn.setAttribute('type', 'button');
									countBtn.setAttribute('aria-label', frappe._('Item quantity'));
									countBtn.addEventListener('keydown', (ev) => {
										if (ev.key === 'Enter' || ev.key === ' ') {
											ev.preventDefault(); ev.stopPropagation();
											const cart = document.querySelector('.customer-cart-container');
											cart && strongScrollIntoView(cart);
										}
									});
									countBtn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); const cart = document.querySelector('.customer-cart-container'); cart && strongScrollIntoView(cart); }, { passive: true });
									tile.appendChild(countBtn);
								}
								tile.__posRefs.countBtn = countBtn;
							}
							// update count button display
							if (qty > 0) {
								tile.__posRefs.countBtn.textContent = String(qty);
								tile.__posRefs.countBtn.style.display = 'inline-flex';
								tile.__posRefs.countBtn.setAttribute('aria-hidden', 'false');
							} else {
								tile.__posRefs.countBtn.textContent = '';
								tile.__posRefs.countBtn.style.display = 'none';
								tile.__posRefs.countBtn.setAttribute('aria-hidden', 'true');
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
				const badgeInterval = setInterval(() => {
					safeExecute(() => {
						const selector = cur_pos?.item_selector;
						selector && selector.update_cart_badges && selector.update_cart_badges();
					}, 'badgeRefresh');
				}, CONFIG.TIMING.POLLING_INTERVAL);
				window.POSMobile.badgeRefreshInterval = badgeInterval;
				GLOBAL_INTERVALS.push(badgeInterval);
			}
		}, 'patchItemSelector');

		// Patch PastOrderList to add auto-scroll when order is selected
		safeExecute(() => {
			if (erpnext?.PointOfSale?.PastOrderList && !erpnext.PointOfSale.PastOrderList.__posMobilePatched) {
				erpnext.PointOfSale.PastOrderList.__posMobilePatched = true;
				const POL = erpnext.PointOfSale.PastOrderList;

				const orig_bind_events = POL.prototype.bind_events;
				POL.prototype.bind_events = function () {
					// Call original bind_events first
					orig_bind_events && orig_bind_events.call(this);

					// Override the click handler to add auto-scroll
					const me = this;
					this.$invoices_container.off('click', '.invoice-wrapper');
					this.$invoices_container.on('click', '.invoice-wrapper', function () {
						const invoice_clicked = $(this);
						const invoice_doctype = invoice_clicked.attr('data-invoice-doctype');
						const invoice_name = readDataAttr(invoice_clicked.get(0), 'data-invoice-name');

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
				POS.prototype.load_summary_of = function (doc, after_submission = false) {
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
			if (!isMobile()) return;

			const container = document.querySelector('.customer-cart-container');
			if (!container) return;

			container.addEventListener('click', function (e) {
				const qtyEl = e.target && e.target.closest && e.target.closest('.item-qty');
				if (!qtyEl) return;

				e.preventDefault();
				e.stopPropagation();

				const wrapper = qtyEl.closest('.cart-item-wrapper');
				if (!wrapper) return;

				const rowName = readDataAttr(wrapper, 'data-row-name');
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
					} catch (err) { }
				});
			}, true);
		}, 'mobileQtyTapIncrement');

		safeExecute(() => {
			let handlerAttached = false;
			let submitting = false;

			function getOrAssignSaleId(frm) {
				try {
					if (!frm.doc.__pos_sale_id) {
						if (window.POSPouch && typeof window.POSPouch.makeUUID === 'function') {
							frm.doc.__pos_sale_id = 'sale:' + window.POSPouch.makeUUID();
						} else {
							frm.doc.__pos_sale_id = 'sale:' + Date.now() + ':' + Math.random().toString(16).slice(2);
						}
					}
					return frm.doc.__pos_sale_id;
				} catch (e) {
					return 'sale:' + Date.now();
				}
			}

			function ensurePaidViewDoc(source) {
				try {
					const d = JSON.parse(JSON.stringify(source || {}));
					const total = Number(d.rounded_total || d.grand_total || 0) || 0;
					d.status = 'Paid';
					d.docstatus = 1;
					d.paid_amount = total;
					if (!Array.isArray(d.payments)) d.payments = [];
					if (d.payments.length === 0) {
						d.payments.push({ mode_of_payment: (d.payments && d.payments[0] && d.payments[0].mode_of_payment) || (d.default_mode_of_payment || 'Cash'), amount: total });
					} else {
						d.payments[0].amount = total;
					}
					return d;
				} catch (e) {
					return source;
				}
			}

			const attach = () => {
				if (handlerAttached) return;
				const container = document.querySelector(CONFIG.CLASSES.PAYMENT_CONTAINER);
				if (!container) {
					console.log('[POS Mobile] Payment container not found yet, retrying...');
					return;
				}
				console.log('[POS Mobile] Complete Order handler attached');
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

					if (submitting) return; // prevent double clicks
					submitting = true;
					try { btn.setAttribute('disabled', 'disabled'); btn.classList.add('disabled'); } catch (e) { }

					const sale_id = getOrAssignSaleId(frm);
					const showPaidSummary = (summaryDoc) => {
						try {
							ctrl.toggle_components(false);
							ctrl.order_summary.toggle_component(true);
							ctrl.order_summary.load_summary_of(summaryDoc, true);
							const el = ctrl.order_summary.$component && ctrl.order_summary.$component.get(0);
							el && strongScrollIntoView(el);
						} catch (err) { }
					};
					const finalize = () => { submitting = false; try { btn.removeAttribute('disabled'); btn.classList.remove('disabled'); } catch (e) { } };

					if (!navigator.onLine) {
						// Offline: queue and immediately show Paid summary view
						const viewDoc = ensurePaidViewDoc(doc);
						const afterQueue = () => {
							frappe.show_alert({ message: frappe._('Order saved offline. Will sync when online.'), indicator: 'blue' });
							frappe.utils.play_sound('submit');
							showPaidSummary(viewDoc);
							finalize();
						};
						if (window.POSPouch && typeof window.POSPouch.writeSaleDoc === 'function') {
							window.POSPouch.writeSaleDoc(Object.assign({}, doc, { __sale_id: sale_id }))
								.then(afterQueue)
								.catch(() => {
									OrderQueue.enqueue(Object.assign({}, doc, { __sale_id: sale_id })).then(afterQueue);
								});
						} else {
							OrderQueue.enqueue(Object.assign({}, doc, { __sale_id: sale_id })).then(afterQueue);
						}
						return;
					}

					// Online: try to submit current doc; if submission fails (network/server error)
					// fall back to offline queue so POS continues to work without internet.
					frm.save('Submit', (r) => {
						if (!r || r.exc) {
							// submission failed: fallback to offline queue
							try {
								const viewDoc = ensurePaidViewDoc(doc);
								const afterQueue = () => {
									frappe.show_alert({ message: frappe._('Order saved offline. Will sync when online.'), indicator: 'blue' });
									frappe.utils.play_sound('submit');
									showPaidSummary(viewDoc);
									finalize();
								};
								if (window.POSPouch && typeof window.POSPouch.writeSaleDoc === 'function') {
									window.POSPouch.writeSaleDoc(Object.assign({}, doc, { __sale_id: sale_id })).then(afterQueue).catch(() => { OrderQueue.enqueue(Object.assign({}, doc, { __sale_id: sale_id })).then(afterQueue); });
								} else {
									OrderQueue.enqueue(Object.assign({}, doc, { __sale_id: sale_id })).then(afterQueue);
								}
								return;
							} catch (err) {
								// if fallback also fails, just finalize and surface error
								console.error('[POS Mobile] submit fallback failed', err);
								finalize();
								return;
							}
						}
						// success path
						try { frappe.utils.play_sound('submit'); showPaidSummary(frm.doc); } catch (err) { }
						finalize();
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

	// Cleanup handler: clears tracked intervals and disconnects observers on unload
	function posMobileCleanup() {
		safeExecute(() => {
			try {
				if (CONFIG.DEBUG) console.info('[POS Mobile] Running posMobileCleanup');
				// Clear tracked intervals
				GLOBAL_INTERVALS.forEach((id) => {
					try { clearInterval(id); if (CONFIG.DEBUG) console.debug('[POS Mobile] cleared interval', id); } catch (e) { }
				});
				GLOBAL_INTERVALS.length = 0;

				// Disconnect observers
				GLOBAL_OBSERVERS.forEach((ob) => {
					try { if (ob && typeof ob.disconnect === 'function') { ob.disconnect(); if (CONFIG.DEBUG) console.debug('[POS Mobile] disconnected observer', ob); } } catch (e) { }
				});
				GLOBAL_OBSERVERS.length = 0;

				// Best-effort: clear known instance-scoped intervals
				try {
					const ctrl = window.cur_pos;
					if (ctrl) {
						if (ctrl._pos_mobile_refresh) { try { clearInterval(ctrl._pos_mobile_refresh); } catch (e) { } ctrl._pos_mobile_refresh = null; if (CONFIG.DEBUG) console.debug('[POS Mobile] cleared ctrl._pos_mobile_refresh'); }
						if (ctrl.item_selector && ctrl.item_selector.__posMobileBadgeInterval) { try { clearInterval(ctrl.item_selector.__posMobileBadgeInterval); } catch (e) { } ctrl.item_selector.__posMobileBadgeInterval = null; if (CONFIG.DEBUG) console.debug('[POS Mobile] cleared item_selector.__posMobileBadgeInterval'); }
					}
				} catch (e) { }
			} catch (e) { }
		}, 'posMobileCleanup');
	}

	// Register unload/pagehide/visibility handlers for cleanup to avoid timers leaking
	try {
		window.addEventListener('pagehide', posMobileCleanup, { passive: true });
		window.addEventListener('beforeunload', posMobileCleanup, { passive: true });
		document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') posMobileCleanup(); }, { passive: true });
		// Expose cleanup for manual invocation in console/tests
		window.POSMobile.cleanup = posMobileCleanup;
	} catch (e) { }

	// Offline order queue API
	const OrderQueue = {
		enqueue(doc) {
			const offlineId = (doc && (doc.__sale_id || doc.__pos_sale_id)) || null;
			return this.list()
				.then((list) => {
					const exists = offlineId && Array.isArray(list)
						? list.some((o) => o && o.doc && ((o.doc.__sale_id || o.doc.__pos_sale_id) === offlineId))
						: false;
					if (exists) return true;
					const payload = { doc, created_at: Date.now(), status: 'queued' };
					return IDB.put('orders', payload);
				})
				.then(() => this.updateIndicator())
				.catch(() => { });
		},
		list() {
			return IDB.open().then(db => new Promise((resolve) => {
				const tx = db.transaction('orders', 'readonly');
				const req = tx.objectStore('orders').getAll();
				req.onsuccess = () => resolve(req.result || []);
			}));
		},
		remove(id) {
			return IDB.open().then(db => new Promise((resolve) => {
				const tx = db.transaction('orders', 'readwrite');
				tx.objectStore('orders').delete(id);
				tx.oncomplete = () => resolve(true);
			}));
		},
		flushInProgress: false,
		flushBackoffMs: 0,
		flush() {
			if (this.flushInProgress || !navigator.onLine) return Promise.resolve();
			this.flushInProgress = true;
			return this.list().then(async (orders) => {
				if (!orders.length) { this.flushInProgress = false; this.flushBackoffMs = 0; this.updateIndicator(); return; }
				// Process a small batch to improve throughput while avoiding hammering the server
				const batchSize = (CONFIG.QUEUE && CONFIG.QUEUE.BATCH_SIZE) || 3;
				const toProcess = orders.slice(0, batchSize);
				for (const order of toProcess) {
					const args = {};
					if (order && order.doc && order.doc.name && !/^New\s/.test(String(order.doc.name))) args.name = order.doc.name;
					const sid = order && order.doc && (order.doc.__sale_id || order.doc.__pos_sale_id);
					if (sid) args.sale_id = sid;
					if (order && order.doc && order.doc.doctype) args.doctype = order.doc.doctype;
					try {
						const r = await frappe.call({ method: CONFIG.SYNC.REMOTE_UPDATE_METHOD || 'pos_mobile.pos_mobile.api.pos_sync.mark_paid', args });
						if (r && r.message && r.message.ok) {
							await this.remove(order.id);
							this.flushBackoffMs = 0;
							this.updateIndicator();
							continue; // next order
						}
						// if server didn't return ok, break to avoid repeating failing payloads
						this.flushBackoffMs = Math.min((this.flushBackoffMs || CONFIG.QUEUE.BACKOFF_BASE_MS) * 2, CONFIG.QUEUE.BACKOFF_MAX_MS);
						break;
					} catch (err) {
						// on error, exponential backoff and stop processing further
						this.flushBackoffMs = Math.min((this.flushBackoffMs || CONFIG.QUEUE.BACKOFF_BASE_MS) * 2, CONFIG.QUEUE.BACKOFF_MAX_MS);
						break;
					}
				}
				this.flushInProgress = false;
				// schedule next flush (respect backoff when errors occurred)
				setTimeout(() => this.flush(), this.flushBackoffMs || CONFIG.QUEUE.FLUSH_INTERVAL_MS);
			});
		},
		updateIndicator() {
			Promise.all([
				this.list().catch(() => []),
				(window.POSPouch && typeof window.POSPouch.countLocalSales === 'function' ? window.POSPouch.countLocalSales() : Promise.resolve(0))
			]).then(([orders, localSales]) => {
				const badge = document.getElementById('pos-offline-badge');
				if (!badge) return;
				if (navigator.onLine) {
					badge.style.display = 'none';
					return;
				}
				const count = (Array.isArray(orders) ? orders.length : 0) + (Number(localSales) || 0);
				const base = frappe && frappe._ ? frappe._('Offline') : 'Offline';
				badge.textContent = count > 0 ? `${base} • ${count}` : base;
				badge.style.display = 'inline-flex';
			}).catch(() => { });
		}
	};

	// Register service worker for offline support
	(function registerPOSServiceWorker() {
		try {
			if ('serviceWorker' in navigator) {
				navigator.serviceWorker.register('/assets/pos_mobile/sw_pos.js').catch(() => {
					// try app path fallback
					navigator.serviceWorker.register('/sw_pos.js').catch(() => { });
				});
				// start periodic queue flush and react to online
				const queueFlushInterval = setInterval(() => { OrderQueue.flush(); }, CONFIG.QUEUE.FLUSH_INTERVAL_MS);
				window.POSMobile.queueFlushInterval = queueFlushInterval;
				GLOBAL_INTERVALS.push(queueFlushInterval);
				window.addEventListener('online', () => OrderQueue.flush(), { passive: true });
				window.addEventListener('offline', () => OrderQueue.updateIndicator(), { passive: true });
			}
		} catch (e) { }
	})();

	// Client push worker: submit local PouchDB sales to ERP endpoint when online
	(function startClientPushWorker() {
		let pushing = false;
		async function tick() {
			if (pushing) return;
			if (!navigator.onLine) return;
			if (!window.POSPouch || !CONFIG.SYNC.REMOTE_UPDATE_METHOD) return;
			const batchSize = (CONFIG.QUEUE && CONFIG.QUEUE.BATCH_SIZE) || 3;
			const batch = await window.POSPouch.listLocalSales(batchSize);
			if (!batch.length) return;
			pushing = true;
			try {
				for (const sale of batch) {
					try {
						const args = {};
						if (sale.doc && sale.doc.name && !/^New\s/.test(String(sale.doc.name))) args.name = sale.doc.name;
						if (sale._id) args.sale_id = sale._id;
						if (sale.doc && sale.doc.doctype) args.doctype = sale.doc.doctype;
						const res = await frappe.call({ method: CONFIG.SYNC.REMOTE_UPDATE_METHOD, args });
						if (res && res.message && res.message.ok) {
							await window.POSPouch.markSynced(sale._id);
						} else {
							break; // stop to avoid hammering when server can't map order
						}
					} catch (e) {
						break; // stop on first failure to avoid hammering
					}
				}
			} finally {
				pushing = false;
			}
		}
		const clientPushInterval = setInterval(() => { if (document.hidden) return; tick(); }, 5000);
		window.POSMobile.clientPushInterval = clientPushInterval;
		GLOBAL_INTERVALS.push(clientPushInterval);
		window.addEventListener('online', () => tick(), { passive: true });
	})();

	// Load PouchDB and initialize local DB for robust offline
	(function initPouchDB() {
		function makeUUID() {
			return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
				const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
				return v.toString(16);
			});
		}

		function afterLoaded() {
			try {
				if (!window.PouchDB) return;
				if (!window.POSDB) {
					window.POSDB = new window.PouchDB('pos_local');
				}
				// start replication if remote configured
				if (CONFIG.SYNC.REMOTE_DB_URL) {
					try {
						const sync = window.POSDB.sync(CONFIG.SYNC.REMOTE_DB_URL, { live: true, retry: true });
						sync.on('change', () => { try { OrderQueue.updateIndicator(); } catch (e) { } });
						sync.on('paused', () => { try { OrderQueue.updateIndicator(); } catch (e) { } });
						sync.on('active', () => { try { OrderQueue.updateIndicator(); } catch (e) { } });
					} catch (e) { }
				}
				// expose helpers
				window.POSPouch = {
					makeUUID,
					async writeSaleDoc(doc) {
						if (!window.POSDB) return;
						const terminal_id = (frappe && frappe.boot && frappe.boot.session && frappe.boot.session.user) || 'terminal';
						const provided = doc && (doc.__sale_id || doc.__pos_sale_id);
						const _id = (typeof provided === 'string' && provided.indexOf('sale:') === 0) ? provided : `sale:${makeUUID()}`;
						// idempotent: skip if already present
						try { const existing = await window.POSDB.get(_id); if (existing) { try { OrderQueue.updateIndicator(); } catch (e) { } return _id; } } catch (e) { }
						const payload = { _id, type: 'sale', created_at: Date.now(), terminal_id, status: 'local', doc };
						try { await window.POSDB.put(payload); } catch (e) { }
						try { OrderQueue.updateIndicator(); } catch (e) { }
						return _id;
					},
					async countLocalSales() {
						if (!window.POSDB) return 0;
						try {
							const res = await window.POSDB.allDocs({ include_docs: true, startkey: 'sale:', endkey: 'sale:\ufff0' });
							return (res.rows || []).filter(r => r.doc && r.doc.status === 'local').length;
						} catch (e) { return 0; }
					},
					async listLocalSales(limit = 5) {
						if (!window.POSDB) return [];
						try {
							const res = await window.POSDB.allDocs({ include_docs: true, startkey: 'sale:', endkey: 'sale:\ufff0' });
							return (res.rows || []).map(r => r.doc).filter(d => d && d.status === 'local').sort((a, b) => (a.created_at || 0) - (b.created_at || 0)).slice(0, limit);
						} catch (e) { return []; }
					},
					async markSynced(id) {
						if (!window.POSDB) return;
						try {
							const doc = await window.POSDB.get(id);
							doc.status = 'synced';
							doc.synced_at = Date.now();
							await window.POSDB.put(doc);
							try { OrderQueue.updateIndicator(); } catch (e) { }
						} catch (e) { }
					}
				};
			} catch (e) { }
		}

		if (window.PouchDB) { afterLoaded(); return; }
		try {
			const s = document.createElement('script');
			s.src = 'https://cdn.jsdelivr.net/npm/pouchdb@7.3.1/dist/pouchdb.min.js';
			s.async = true;
			s.onload = afterLoaded;
			document.head.appendChild(s);
		} catch (e) { }
	})();

	console.log('[POS Mobile] Initialization complete! Available as window.POSMobile');

})(); 
