# POS Mobile – POS UI/UX Enhancements for ERPNext

POS Mobile is a custom Frappe app that delivers a modern, mobile‑friendly Point of Sale experience for ERPNext without modifying core files. It injects styles and behavior overrides only when the POS page is loaded.

## Highlights

- Modern payment UI on desktop and mobile
  - Card styling for mode of payment with clear selected state
  - Larger, tactile numpad with press feedback
  - Colored totals (Grand Total, Paid, Remaining/Change) with 3D‑like cards
- Smooth auto‑scrolling in key flows
  - Scroll to POS sections on show (cart, item details, payment)
  - After customer selection, auto‑scroll to All Items
  - On checkout, focus the payment panel
- Item selector improvements (mobile first)
  - Responsive grid for item tiles
  - Full‑width Item Cart button in the filter bar with live selected count
  - Per‑item quantity badges on tiles (keeps in sync with cart)
- Accessibility and keyboard polish
  - Aria attributes for totals region and selected payment method
  - Delete key mapped to Backspace behavior for numpad

## How It Works

- The app wires a POS‑only override script using Frappe hooks:

  - `pos_mobile/pos_mobile/hooks.py`
    - `page_js = {"point-of-sale": "public/js/pos_overrides.js"}`

- The override script (`public/js/pos_overrides.js`) is idempotent and scoped:
  - Injects CSS once per session
  - Monkey‑patches safe methods (Controller, ItemDetails, Payment)
  - Adds UI elements (Item Cart button) only if missing
  - Uses robust smooth scrolling that re‑fires after layout settles

## Installation

```bash
bench build
bench --site YOUR_SITE install-app pos_mobile  # if not yet installed
bench --site YOUR_SITE clear-cache
```

Open the POS page. The overrides load automatically.

## Configuration

No configuration is required. All changes are limited to the POS page route (`point-of-sale`). If you wish to disable the overrides temporarily, comment the `page_js` hook in `hooks.py`, rebuild, and clear cache.

## What We Override (Safely)

- Styles: Payment cards, totals, numpad, item selector grid, and mobile Item Cart CTA
- Controller: Refresh item badges after cart updates; smooth‑scroll on wrapper show
- Item Details: Smooth‑scroll when the panel opens
- Customer flow: Auto‑scroll to All Items after customer is selected
- Payment: Auto‑refresh while panel is open; a11y/keyboard tweaks; strong focus scroll



## Development Notes

- The override script avoids hard dependencies on internal structures and checks for object existence before patching.
- All DOM injections are guarded to be idempotent.
- Smooth scroll helper is resilient (fires again after layout changes).
- Periodic light polling updates item badges and the Item Cart button label to keep counts current even across async flows.

## License

MIT
