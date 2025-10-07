import json
from typing import Any, Dict, List, Optional, Union

import frappe
import hashlib
from frappe import _

from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_stock_availability
from erpnext.stock.get_item_details import get_pos_profile as _get_pos_profile


@frappe.whitelist()
def get_available_qty(
    item_codes: Union[str, List[str], None] = None,
    pos_profile: Optional[str] = None,
    warehouse: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Batch API to fetch available stock quantity for multiple items for POS.

    Args:
        item_codes: List of Item Codes, or a JSON-encoded list of Item Codes. Optional; empty or missing returns {}.
        pos_profile: POS Profile to derive context (optional; auto-resolved for current user if omitted).
        warehouse: Ignored. Always resolved from the POS Profile.

    Returns:
        dict mapping item_code -> { actual_qty: number, is_stock_item: bool }
    """
    # Parse item_codes if it's a JSON string, a single code, or a comma-separated list
    if isinstance(item_codes, str):
        try:
            parsed = json.loads(item_codes)
            item_codes = parsed
        except Exception:
            # treat as single item code or comma-separated list
            item_codes = [s.strip() for s in item_codes.split(',') if s and s.strip()]

    if not isinstance(item_codes, list) or not item_codes:
        return {}

    # Normalize and deduplicate codes
    codes = [str(c).strip() for c in item_codes if c is not None]
    # keep insertion order while deduping
    seen = set()
    codes = [c for c in codes if c and (c not in seen and not seen.add(c))]

    # Resolve POS Profile first (if not provided, use default profile for current user)
    profile_doc = None
    if pos_profile:
        try:
            profile_doc = frappe.get_cached_doc("POS Profile", pos_profile)
        except Exception:
            profile_doc = None
    if not profile_doc:
        try:
            profile_doc = _get_pos_profile(None, None)
        except Exception:
            profile_doc = None

    if not profile_doc:
        return {}

    wh = profile_doc.warehouse
    if not wh:
        return {}

    # Bulk fetch item metadata to avoid unnecessary heavy calls
    try:
        metas = frappe.get_all('Item', filters={'name': ['in', codes]}, fields=['name', 'is_stock_item'])
        meta_map = {m.name: bool(m.is_stock_item) for m in metas}
    except Exception:
        meta_map = {}

    # Short TTL cache to reduce repeated load (e.g., POS polling). Cache per-warehouse + codes hash.
    try:
        cache = frappe.cache()
    except Exception:
        cache = None

    # create a small deterministic cache key based on warehouse and codes
    codes_blob = ','.join(codes)
    key_hash = hashlib.sha1(codes_blob.encode('utf-8')).hexdigest()[:12]
    cache_key = f"pos_stock:{wh}:{key_hash}"
    TTL_SECONDS = 5  # short TTL to keep near-real-time correctness while reducing load

    def compute():
        result: Dict[str, Dict[str, Any]] = {}
        for code in codes:
            try:
                is_stock = meta_map.get(code, False)
                if is_stock:
                    qty, is_stock_item = get_stock_availability(code, wh)
                    result[code] = {"actual_qty": qty, "is_stock_item": True}
                else:
                    result[code] = {"actual_qty": 0, "is_stock_item": False}
            except Exception:
                result[code] = {"actual_qty": 0, "is_stock_item": None}
        return result

    if cache:
        try:
            # get_value will call compute() if key missing and set it with expiry
            return cache.get_value(cache_key, compute, expires=TTL_SECONDS)
        except Exception:
            # on cache failure, compute directly
            return compute()

    return compute()
