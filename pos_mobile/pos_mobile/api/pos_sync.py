import json
from typing import Any, Dict, Union, Optional

import frappe
from frappe import _
from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
import re


@frappe.whitelist(methods=["POST"])  # type: ignore[misc]
def submit_sale(sale: Union[str, Dict[str, Any]], sale_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Accept offline POS sale payload and create a POS Invoice idempotently.

    Args:
        sale: JSON string or dict of a POS Invoice document (POS payload).
        sale_id: Optional client-side unique id (e.g., "sale:{uuid}") for idempotency.

    Returns:
        dict with keys { ok, name, message }
    """
    # Require authenticated session to reduce abuse (disallow Guest)
    try:
        user = frappe.session.user
    except Exception:
        user = None
    if not user or user == 'Guest':
        frappe.throw(_("Authentication required"), frappe.PermissionError)

    # sanitize sale_id: accept a conservative charset only
    if sale_id:
        if not re.match(r'^[A-Za-z0-9:_-]+$', sale_id):
            # drop invalid sale_id to avoid injection/abuse
            sale_id = None

    try:
        doc = json.loads(sale) if isinstance(sale, str) else sale
    except Exception:
        # avoid logging raw payload content; log only size/type
        payload_info = f"type={type(sale).__name__}, len={len(sale) if isinstance(sale, (str, bytes)) else 'N/A'}"
        frappe.log_error(f"Invalid sale payload ({payload_info})", "POS Offline Submit")
        frappe.throw(_("Invalid sale payload"))

    if not isinstance(doc, dict):
        frappe.throw(_("Sale payload must be a POS Invoice doc"))

    # Basic payload size limits to prevent large/abusive submissions
    MAX_ITEMS = 200
    items = doc.get('items') or []
    if not isinstance(items, list):
        frappe.throw(_("Items must be a list"))
    if len(items) > MAX_ITEMS:
        frappe.throw(_("Too many items in sale payload"))

    # Validate individual item entries minimally (code exists, qty numeric)
    for it in items:
        if not isinstance(it, dict):
            frappe.throw(_("Invalid item entry in payload"))
        code = it.get('item_code') or it.get('code') or it.get('item')
        if not code:
            frappe.throw(_("Each item must include item_code"))
        # ensure item exists
        try:
            if not frappe.db.exists('Item', code):
                frappe.throw(_("Unknown item: {0}").format(code))
        except Exception:
            # if DB check fails, abort safely
            frappe.throw(_("Item validation failed"))
        # qty checks
        qty = it.get('qty', 0)
        try:
            qty_val = float(qty)
        except Exception:
            frappe.throw(_("Item qty must be a number"))
        if qty_val < 0:
            frappe.throw(_("Item qty must be non-negative"))

    # Normalize/validate DocType
    dt = (doc.get("doctype") or "").strip()
    dt_lower = dt.lower()
    if dt_lower == "pos invoice":
        doc["doctype"] = "POS Invoice"
    elif dt_lower == "sales invoice":
        doc["doctype"] = "Sales Invoice"
    else:
        # If payload lacks/has unexpected doctype, infer from POS Settings
        try:
            inferred = frappe.db.get_single_value("POS Settings", "invoice_type") or "POS Invoice"
        except Exception:
            inferred = "POS Invoice"
        doc["doctype"] = inferred

    if doc.get("doctype") not in ("POS Invoice", "Sales Invoice"):
        frappe.log_error(f"Unexpected doctype in payload: {dt}", "POS Offline Submit")
        frappe.throw(_("Sale payload must be a POS or Sales Invoice doc"))

    target_dt = doc.get("doctype")
    # Ensure POS mode when using Sales Invoice in POS
    if target_dt == "Sales Invoice":
        doc["is_pos"] = 1

    # Basic sanitization: don't trust incoming name and workflow fields
    unsafe_fields = ["name", "docstatus", "owner", "creation", "modified", "modified_by", "amended_from", "workflow_state", "naming_series"]
    for f in unsafe_fields:
        if f in doc:
            doc.pop(f, None)

    # Idempotency: try to find an existing invoice via client-provided sale_id mapped into remarks
    # If a custom field exists (e.g., custom_pos_offline_id) prefer that; otherwise, fallback to remarks search
    existing_name = None
    if sale_id:
        try:
            # try custom field first
            existing_name = frappe.db.get_value(
                target_dt, {"custom_pos_offline_id": sale_id}, "name"
            )
        except Exception:
            existing_name = None
        if not existing_name:
            # We store a precise tag in remarks: [offline:{sale_id}] — search for that exact tag to avoid false positives
            tag = f"[offline:{sale_id}]"
            try:
                existing_name = frappe.db.get_value(
                    target_dt,
                    {"remarks": ["like", f"%{tag}%"]},
                    "name",
                )
            except Exception:
                existing_name = None
        if existing_name:
            return {"ok": True, "name": existing_name, "message": _("Already processed")}

    # Ensure minimal required fields
    if not doc.get("customer"):
        frappe.throw(_("Customer is required"))
    if not doc.get("items"):
        frappe.throw(_("Items are required"))
    if not doc.get("company"):
        frappe.throw(_("Company is required"))
    if target_dt == "POS Invoice" and not doc.get("pos_profile"):
        frappe.throw(_("POS Profile is required"))

    # Optionally embed the offline id into remarks for auditability
    if sale_id:
        remarks = (doc.get("remarks") or "").strip()
        tag = f"[offline:{sale_id}]"
        if tag not in remarks:
            doc["remarks"] = f"{remarks + ' ' if remarks else ''}{tag}"
        # If custom field for idempotency exists, set it
        try:
            meta = frappe.get_meta(target_dt)
            if getattr(meta, "has_field", None) and meta.has_field("custom_pos_offline_id"):
                doc["custom_pos_offline_id"] = sale_id
        except Exception:
            pass

    # Permission check
    if not frappe.has_permission(target_dt, "create"):
        frappe.throw(_("Not permitted to create {0}").format(target_dt), frappe.PermissionError)

    si = frappe.get_doc(doc)
    # Ensure full payment so the invoice can be submitted as Paid
    try:
        # Populate POS defaults and payment rows
        if target_dt == "POS Invoice":
            try:
                si.set_missing_values(for_validate=False)
            except Exception:
                pass
        total = (si.rounded_total or si.grand_total or 0) or 0
        payments = si.get("payments") or []
        if total and (not payments or sum((p.amount or 0) for p in payments) < total):
            # Try to create default payment rows from POS Profile
            if not payments:
                try:
                    si.set_pos_fields(for_validate=False)
                    payments = si.get("payments") or []
                except Exception:
                    payments = si.get("payments") or []
            # Fallback: append payment using first Mode of Payment from POS Profile
            if not payments:
                try:
                    profile_name = getattr(si, "pos_profile", None)
                    if profile_name:
                        profile = frappe.get_cached_doc("POS Profile", profile_name)
                        first_row = (profile.payments[0] if profile and profile.get("payments") else None)
                        if first_row:
                            p = si.append("payments", {})
                            p.mode_of_payment = first_row.mode_of_payment
                            try:
                                acc = get_bank_cash_account(p.mode_of_payment, si.company).get("account")
                                p.account = acc
                            except Exception:
                                pass
                            payments = si.get("payments") or []
                except Exception:
                    pass
            # Set amount to fully pay
            if payments:
                payments[0].amount = total
                try:
                    si.paid_amount = total
                except Exception:
                    pass
    except Exception:
        pass
    try:
        si.insert()
    except Exception as e:
        if sale_id:
            existing_name = None
            try:
                existing_name = frappe.db.get_value(target_dt, {"custom_pos_offline_id": sale_id}, "name")
            except Exception:
                existing_name = None
            if not existing_name:
                existing_name = frappe.db.get_value(target_dt, {"remarks": ["like", f"%{sale_id}%"]}, "name")
            if existing_name:
                return {"ok": True, "name": existing_name, "message": _("Already processed")}
        frappe.log_error(frappe.get_traceback(), "POS Offline Insert Failed")
        raise
    # Submit if POS profile would normally auto-submit
    try:
        si.submit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "POS Offline Submit Failed")
        return {"ok": True, "name": si.name, "message": _("created (draft)")}

    return {"ok": True, "name": si.name, "message": _("created")}


@frappe.whitelist(methods=["POST"])  # type: ignore[misc]
def mark_paid(name: Optional[str] = None, sale_id: Optional[str] = None, doctype: Optional[str] = None) -> Dict[str, Any]:
    """
    Mark an existing POS/Sales Invoice as Paid without creating a new invoice.

    It attempts to locate an existing invoice using, in priority order:
      - Explicit name (and optional doctype)
      - sale_id matched against custom_pos_offline_id or present in remarks

    If the invoice is found and is a draft, it will be submitted as fully paid.
    If already submitted, it returns as already processed.
    """
    dt_candidates = []
    if doctype:
        if doctype in ("POS Invoice", "Sales Invoice"):
            dt_candidates = [doctype]
        else:
            # tolerate case-insensitive matches
            l = doctype.lower().strip()
            if l == "pos invoice":
                dt_candidates = ["POS Invoice"]
            elif l == "sales invoice":
                dt_candidates = ["Sales Invoice"]
    if not dt_candidates:
        dt_candidates = ["POS Invoice", "Sales Invoice"]

    target_dt = None
    target_name = None

    # 1) Try by explicit name first
    if name:
        for dt in dt_candidates:
            try:
                if frappe.db.exists(dt, name):
                    target_dt, target_name = dt, name
                    break
            except Exception:
                pass

    # 2) Try by sale_id markers (custom field or remarks)
    if not target_name and sale_id:
        for dt in dt_candidates:
            try:
                found = frappe.db.get_value(dt, {"custom_pos_offline_id": sale_id}, "name")
            except Exception:
                found = None
            if not found:
                try:
                    found = frappe.db.get_value(dt, {"remarks": ["like", f"%{sale_id}%"]}, "name")
                except Exception:
                    found = None
            if found:
                target_dt, target_name = dt, found
                break

    if not target_name:
        return {"ok": False, "message": _("Invoice not found")}

    if not frappe.has_permission(target_dt, "submit"):
        frappe.throw(_(f"Not permitted to submit {target_dt}"), frappe.PermissionError)

    si = frappe.get_doc(target_dt, target_name)

    # if already submitted and paid, treat as idempotent success
    try:
        if si.docstatus == 1 and getattr(si, "status", None) in ("Paid", "Consolidated"):
            return {"ok": True, "name": si.name, "message": _("Already processed")}
    except Exception:
        pass

    # If draft, ensure payments cover full total and submit
    if si.docstatus == 0:
        try:
            total = (getattr(si, "rounded_total", None) or getattr(si, "grand_total", None) or 0) or 0
            payments = si.get("payments") or []
            if total and (not payments or sum((p.amount or 0) for p in payments) < total):
                if not payments:
                    try:
                        si.set_pos_fields(for_validate=False)
                        payments = si.get("payments") or []
                    except Exception:
                        payments = si.get("payments") or []
                if not payments:
                    try:
                        profile_name = getattr(si, "pos_profile", None)
                        if profile_name:
                            profile = frappe.get_cached_doc("POS Profile", profile_name)
                            first_row = (profile.payments[0] if profile and profile.get("payments") else None)
                            if first_row:
                                p = si.append("payments", {})
                                p.mode_of_payment = first_row.mode_of_payment
                                try:
                                    acc = get_bank_cash_account(p.mode_of_payment, si.company).get("account")
                                    p.account = acc
                                except Exception:
                                    pass
                                payments = si.get("payments") or []
                    except Exception:
                        pass
                if payments:
                    payments[0].amount = total
                    try:
                        si.paid_amount = total
                    except Exception:
                        pass
        except Exception:
            pass
        try:
            si.save()
        except Exception:
            frappe.log_error(frappe.get_traceback(), "POS mark_paid save failed")
            raise
        try:
            si.submit()
        except Exception:
            frappe.log_error(frappe.get_traceback(), "POS mark_paid submit failed")
            return {"ok": True, "name": si.name, "message": _("saved (draft)")}
        return {"ok": True, "name": si.name, "message": _("submitted")}

    # If already submitted but not Paid, don't create another. Report current state.
    return {"ok": True, "name": si.name, "message": _("already submitted")}


