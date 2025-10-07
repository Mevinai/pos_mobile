from __future__ import annotations

"""
Server-side override for ERPNext's stock.get_item_details helpers.

This module applies focused patches to tolerate cases where `doc` is None or
lacks expected dict-like methods inside ERPNext utilities. It includes:

1) A safe wrapper for update_stock to ensure a dict-like object is passed and
   fallbacks to values from ctx when needed.
2) A safe wrapper for get_filtered_serial_nos to avoid iterating when doc/items
   are absent.

Do NOT import this in __init__.py. It is wired via a server hook (before_request)
so it is applied at request time, not at module import.
"""

def apply_item_details_patches() -> None:
    try:
        import importlib
        gid = importlib.import_module("erpnext.stock.get_item_details")
    except Exception:
        # erpnext not available yet (e.g., during tooling/migrations); ignore
        return

    # 1) Patch update_stock to tolerate None doc and fallback to ctx
    if not getattr(getattr(gid, "update_stock", None), "__pos_mobile_patched__", False):
        _orig_update_stock = getattr(gid, "update_stock", None)
        if callable(_orig_update_stock):

            def _resolve_from_ctx(ctx, key, default=None):
                # Try ctx.doc, then ctx as dict/namespace
                try:
                    if ctx is None:
                        return default
                    # ctx.doc (dict-like)
                    doc_attr = getattr(ctx, "doc", None)
                    if isinstance(doc_attr, dict):
                        return doc_attr.get(key, default)
                    # ctx as dict
                    if isinstance(ctx, dict):
                        return ctx.get(key, default)
                    # generic getattr on ctx
                    return getattr(ctx, key, default)
                except Exception:
                    return default

            class _DocProxy(dict):
                """Dict-like proxy used when original doc is None or non-dict.
                Provides .get() and falls back to values from ctx when key is missing.
                """

                def __init__(self, ctx, orig_doc):
                    super().__init__()
                    self._ctx = ctx
                    if isinstance(orig_doc, dict):
                        # copy existing keys if any
                        for k, v in orig_doc.items():
                            super().__setitem__(k, v)

                def get(self, key, default=None):
                    if key in self:
                        return super().get(key, default)
                    return _resolve_from_ctx(self._ctx, key, default)

                # Keep dict semantics
                def __getitem__(self, key):
                    if key in self:
                        return super().__getitem__(key)
                    val = _resolve_from_ctx(self._ctx, key)
                    if val is None:
                        raise KeyError(key)
                    return val

            def _safe_update_stock(ctx, out, doc=None):
                # Ensure we pass a dict-like object with .get()
                proxy_doc = doc if isinstance(doc, dict) else _DocProxy(ctx, doc)
                # Best-effort: populate commonly used keys if absent
                # e.g., selling_price_list used inside update_stock
                if proxy_doc.get("selling_price_list") is None:
                    spl = _resolve_from_ctx(ctx, "selling_price_list")
                    if spl is not None:
                        proxy_doc["selling_price_list"] = spl
                return _orig_update_stock(ctx, out, proxy_doc)

            # mark and apply patch
            setattr(_safe_update_stock, "__pos_mobile_patched__", True)
            gid.update_stock = _safe_update_stock

    # 2) Patch get_filtered_serial_nos to tolerate None/empty doc.items
    if not getattr(getattr(gid, "get_filtered_serial_nos", None), "__pos_mobile_patched__", False):
        _orig_get_filtered_serial_nos = getattr(gid, "get_filtered_serial_nos", None)
        if callable(_orig_get_filtered_serial_nos):

            def _safe_get_filtered_serial_nos(serial_nos, doc=None):
                """Safe wrapper around ERPNext's get_filtered_serial_nos.

                If doc is None or doesn't provide an iterable `items` collection, do not attempt
                to filter and simply return the provided serial numbers. This mirrors a
                permissive behavior to avoid request failures.
                """
                try:
                    items = None
                    if doc is None:
                        items = None
                    elif isinstance(doc, dict):
                        items = doc.get("items")
                    else:
                        # doc could be a Frappe Document or a proxy with .get
                        try:
                            items = doc.get("items")
                        except Exception:
                            items = None

                    # If there are no items to filter against, return as-is
                    if not items:
                        return serial_nos

                    # Delegate to original implementation when items are present
                    return _orig_get_filtered_serial_nos(serial_nos, doc)
                except Exception:
                    # Be conservative; avoid crashing and return input
                    return serial_nos

            setattr(_safe_get_filtered_serial_nos, "__pos_mobile_patched__", True)
            gid.get_filtered_serial_nos = _safe_get_filtered_serial_nos


# Idempotent entry-point for hooks
_patch_applied = False

def ensure_patched() -> None:
    """Idempotent hook entry point to apply overrides once per process/request."""
    global _patch_applied
    if _patch_applied:
        return
    apply_item_details_patches()
    _patch_applied = True
