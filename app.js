/* BizQuick — invoice generator */
(function () {
  "use strict";

  const CFG = window.BIZQUICK_CONFIG;
  const DRAFT_KEY = "bizquick.draft.v1";
  const SETTINGS_KEY = "bizquick.settings.v1";
  const UDM_OPTIONS = ["Ltr", "Kgs", "Pcs", "Drums"];
  const MM = 96 / 25.4; // CSS px per mm

  // ---------------------------------------------------------------- storage
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  };

  function blankItem(prev) {
    return {
      name: "", hsn: "", udm: "Ltr", qty: "", rate: "",
      cgst: prev ? prev.cgst : "", sgst: prev ? prev.sgst : "", igst: prev ? prev.igst : ""
    };
  }

  function blankState() {
    return {
      poType: "Verbal", poNumber: "", reverseCharge: "No",
      invoiceNo: "", invoiceDate: todayISO(), state: "", stateCode: CFG.defaultStateCode || "",
      transportMode: "", vehicleNumber: "", dateOfSupply: todayISO(), placeOfSupply: "",
      billName: "", billAddress: "", billState: "", billStateCode: "", billGstin: "",
      sameAsBill: false,
      shipName: "", shipAddress: "", shipState: "", shipStateCode: "", shipGstin: "",
      ewayBill: "",
      items: [blankItem()]
    };
  }

  let state = Object.assign(blankState(), store.get(DRAFT_KEY, {}));
  if (!Array.isArray(state.items) || !state.items.length) state.items = [blankItem()];
  let settings = Object.assign({ bankAccount: "", bankIfsc: "" }, store.get(SETTINGS_KEY, {}));

  // ---------------------------------------------------------------- helpers
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return d + "-" + m + "-" + y;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const num = (s) => {
    if (s === "" || s == null) return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  };

  const RULES = {
    digits: (v) => v.replace(/\D/g, ""),
    alpha: (v) => v.replace(/[^A-Za-z ]/g, ""),
    alnum: (v) => v.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    gstin: (v) => v.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    decimal: (v) => {
      v = v.replace(/[^0-9.]/g, "");
      const i = v.indexOf(".");
      return i === -1 ? v : v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "");
    },
    percent: (v) => {
      v = RULES.decimal(v);
      return parseFloat(v) > 100 ? "100" : v;
    }
  };
  function applyRule(el) {
    const rule = el.dataset.rule;
    if (!rule || !RULES[rule]) return;
    const before = el.value;
    let after = RULES[rule](before);
    if (el.maxLength > 0) after = after.slice(0, el.maxLength);
    if (after !== before) {
      const pos = Math.max(0, (el.selectionStart || 0) - (before.length - after.length));
      el.value = after;
      try { el.setSelectionRange(pos, pos); } catch (e) { /* some inputs don't support it */ }
    }
  }
  function limitLines(el) {
    const max = parseInt(el.dataset.maxlines, 10);
    if (!max) return;
    const lines = el.value.split("\n");
    if (lines.length > max) el.value = lines.slice(0, max).join("\n");
  }

  // ------------------------------------------------------- number to words
  const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  function twoDigits(n) {
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  }
  function threeDigits(n) {
    const h = Math.floor(n / 100), r = n % 100;
    return [h ? ONES[h] + " hundred" : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
  }
  function indianWords(n) {
    if (n === 0) return "zero";
    const parts = [];
    const crore = Math.floor(n / 1e7);
    let rest = n % 1e7;
    const lakh = Math.floor(rest / 1e5); rest %= 1e5;
    const thousand = Math.floor(rest / 1000); rest %= 1000;
    if (crore) parts.push(indianWords(crore) + " crore");
    if (lakh) parts.push(twoDigits(lakh) + " lakh");
    if (thousand) parts.push(twoDigits(thousand) + " thousand");
    if (rest) parts.push(threeDigits(rest));
    return parts.join(" ");
  }
  function amountInWords(amount) {
    const total = round2(amount);
    const rupees = Math.floor(total);
    const paise = Math.round((total - rupees) * 100);
    let s = "Rupees " + indianWords(rupees);
    if (paise) s += " and " + twoDigits(paise) + " paise";
    return "(" + s + " only)";
  }

  // ------------------------------------------------------------ calculation
  function compute() {
    const rows = [];
    state.items.forEach((it) => {
      const has = it.name.trim() || it.qty !== "" || it.rate !== "";
      if (!has) return;
      const qty = num(it.qty), rate = num(it.rate);
      const taxable = qty != null && rate != null ? round2(qty * rate) : null;
      const tax = (r) => {
        const pr = num(r);
        return pr == null || taxable == null ? null : round2(taxable * pr / 100);
      };
      const cgst = tax(it.cgst), sgst = tax(it.sgst), igst = tax(it.igst);
      const total = taxable == null ? null : round2(taxable + (cgst || 0) + (sgst || 0) + (igst || 0));
      rows.push({ it, qty, rate, taxable, cgst, sgst, igst, total });
    });

    const sum = (key) => {
      const vals = rows.map((r) => r[key]).filter((v) => v != null);
      return vals.length ? round2(vals.reduce((a, b) => a + b, 0)) : null;
    };
    const uniformRate = (key) => {
      const rates = rows.filter((r) => r[key] != null).map((r) => r.it[key]);
      if (!rates.length) return "";
      const first = num(rates[0]);
      return rates.every((x) => num(x) === first) ? rates[0] : "";
    };
    const t = {
      taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), total: sum("total"),
      cgstRate: uniformRate("cgst"), sgstRate: uniformRate("sgst"), igstRate: uniformRate("igst")
    };
    const taxes = [t.cgst, t.sgst, t.igst].filter((v) => v != null);
    t.gst = taxes.length ? round2(taxes.reduce((a, b) => a + b, 0)) : null;
    t.afterTax = t.taxable == null ? null : round2(t.taxable + (t.gst || 0));

    // Show paise everywhere if any amount has paise, so columns line up.
    const all = [];
    rows.forEach((r) => all.push(r.taxable, r.cgst, r.sgst, r.igst, r.total));
    all.push(t.taxable, t.cgst, t.sgst, t.igst, t.gst, t.afterTax);
    const decimals = all.some((v) => v != null && Math.round(v * 100) % 100 !== 0) ? 2 : 0;
    return { rows, t, decimals };
  }

  // ------------------------------------------------------------- rendering
  function renderInvoice(c) {
    const s = state;
    const fmt = (v) => v == null ? "" : v.toLocaleString("en-IN", { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
    const ship = s.sameAsBill
      ? { name: s.billName, address: s.billAddress, state: s.billState, code: s.billStateCode, gstin: s.billGstin }
      : { name: s.shipName, address: s.shipAddress, state: s.shipState, code: s.shipStateCode, gstin: s.shipGstin };
    const poValue = s.poType === "Written" ? (s.poNumber || "") : "VERBAL";
    const rc = s.reverseCharge === "Yes"
      ? 'Yes/<span class="strike">No</span>'
      : '<span class="strike">Yes</span>/No';

    const itemRows = c.rows.map((r, i) => `
      <tr class="item-row">
        <td class="ctr">${i + 1}</td>
        <td class="nm">${esc(r.it.name)}</td>
        <td class="ctr fit">${esc(r.it.hsn)}</td>
        <td class="fit" style="padding-left:1.2mm">${r.it.name || r.it.qty ? esc(r.it.udm) : ""}</td>
        <td class="n fit">${esc(r.it.qty)}</td>
        <td class="fit" style="padding-left:1.2mm">${esc(r.it.rate)}</td>
        <td class="n fit">${fmt(r.taxable)}</td>
        <td class="ctr fit">${r.cgst != null ? esc(r.it.cgst) : ""}</td>
        <td class="n fit">${fmt(r.cgst)}</td>
        <td class="ctr fit">${r.sgst != null ? esc(r.it.sgst) : ""}</td>
        <td class="n fit">${fmt(r.sgst)}</td>
        <td class="ctr fit">${r.igst != null ? esc(r.it.igst) : ""}</td>
        <td class="n fit">${fmt(r.igst)}</td>
        <td class="n fit">${fmt(r.total)}</td>
      </tr>`).join("");

    const t = c.t;
    const words = t.afterTax != null ? amountInWords(t.afterTax) : "";
    const cols = [10.8, 34.1, 12.2, 10.8, 12.2, 12.2, 17.1, 9.5, 16.2, 9.5, 15.9, 8.4, 10.4, 17.5]
      .map((w) => `<col style="width:${w}mm">`).join("");

    return `
<div class="inv">
  <div class="inv-head">
    <div class="inv-co">${esc(CFG.companyName)}</div>
    <div class="inv-addr">${esc(CFG.companyAddress)}</div>
  </div>

  <div class="inv-box">
    <div class="ra b">
      <div class="ra-po">
        <div>PO NO.<span class="po-val">${esc(poValue)}</span></div>
        <div class="strike">Vendor Code:</div>
      </div>
      <div class="ra-title">INVOICE</div>
      <div class="ra-gst">GST NO: ${esc(CFG.gstNo)}</div>
    </div>

    <table class="rb b">
      <tr>
        <td class="c1">
          <div class="kv left">
            <span class="k">Reverse Charge</span><span class="v">: ${rc}</span>
            <span class="k">Invoice No.</span><span class="v">: ${esc(s.invoiceNo)}</span>
            <span class="k">Invoice Date</span><span class="v">: ${esc(fmtDate(s.invoiceDate))}</span>
          </div>
        </td>
        <td class="c2"></td>
        <td class="c3">
          <div class="kv right">
            <span class="k">Transportation Mode</span><span class="v">: ${esc(s.transportMode)}</span>
            <span class="k">Vehicle Number</span><span class="v">: ${esc(s.vehicleNumber)}</span>
            <span class="k">Date of Supply</span><span class="v">: ${esc(fmtDate(s.dateOfSupply))}</span>
            <span class="k">Place of Supply</span><span class="v">: ${esc(s.placeOfSupply)}</span>
          </div>
        </td>
      </tr>
      <tr class="rb2">
        <td class="c1"><div class="kv left"><span class="k">State</span><span class="v">: ${esc(s.state)}</span></div></td>
        <td class="c2" style="padding:0"><div class="sc"><span class="lbl">State Code :</span><span class="box07">${esc(s.stateCode)}</span></div></td>
        <td class="c3"></td>
      </tr>
    </table>

    <table class="rc b">
      <tr><td class="h1">Details of Receiver / Billed to:</td><td>Details of Consignee / Shipped to:</td></tr>
    </table>

    <table class="rd b">
      <tr>
        <td class="p1">
          <div class="party bill">
            <div class="row"><span>Name</span><span>:</span><span class="v">${esc(s.billName)}</span></div>
            <div class="row addr"><span>Address</span><span>:</span><span class="v">${esc(s.billAddress)}</span></div>
            <div class="row"><span>State</span><span>:</span><span class="v">${esc(s.billState)}</span></div>
            <div class="row"><span>State Code</span><span></span><span class="v">${esc(s.billStateCode)}</span></div>
            <div class="row"><span>GSTIN</span><span>:</span><span class="v">${esc(s.billGstin)}</span></div>
          </div>
        </td>
        <td>
          <div class="party ship">
            <div class="row"><span>Name</span><span class="v">: ${esc(ship.name)}</span></div>
            <div class="row addr"><span>Address</span><span class="v">: ${esc(ship.address).replace(/\n/g, "\n  ")}</span></div>
            <div class="row"><span>State</span><span class="v">: ${esc(ship.state)}</span></div>
            <div class="row"><span>State Code</span><span class="v">${ship.code ? "&nbsp;&nbsp;" + esc(ship.code) : ""}</span></div>
            <div class="row"><span>GSTIN</span><span class="v">${ship.gstin ? "&nbsp;&nbsp;" + esc(ship.gstin) : ""}</span></div>
          </div>
        </td>
      </tr>
    </table>

    <div class="re b"></div>

    <table class="it">
      <colgroup>${cols}</colgroup>
      <thead>
        <tr>
          <th rowspan="2">S.No</th>
          <th rowspan="2">Name of<br>Product/Service</th>
          <th rowspan="2">HSN<br>ACS</th>
          <th rowspan="2">UDM</th>
          <th rowspan="2">Qty</th>
          <th rowspan="2">Rate</th>
          <th rowspan="2" class="tv">Taxable<br>Value</th>
          <th colspan="2" class="grp">CGST</th>
          <th colspan="2" class="grp">SGST</th>
          <th colspan="2" class="grp">IGST</th>
          <th rowspan="2" style="vertical-align:top;padding-top:.6mm">Total</th>
        </tr>
        <tr>
          <th class="sub">Rate</th><th class="sub">Amt</th>
          <th class="sub">Rate</th><th class="sub">Amt</th>
          <th class="sub">Rate</th><th class="sub">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="filler">${"<td></td>".repeat(14)}</tr>
        <tr class="tot">
          <td colspan="4" class="totlbl">TOTAL</td>
          <td></td><td></td>
          <td class="n fit">${fmt(t.taxable)}</td>
          <td class="ctr fit">${t.cgst != null ? esc(t.cgstRate) : ""}</td>
          <td class="n fit">${fmt(t.cgst)}</td>
          <td class="ctr fit">${t.sgst != null ? esc(t.sgstRate) : ""}</td>
          <td class="n fit">${fmt(t.sgst)}</td>
          <td class="ctr fit">${t.igst != null ? esc(t.igstRate) : ""}</td>
          <td class="n fit">${fmt(t.igst)}</td>
          <td class="n fit">${fmt(t.total)}</td>
        </tr>
      </tbody>
    </table>

    <div class="lw" style="height:78mm">
      <div class="lw-left">
        <div class="words">${esc(words)}</div>
        <div class="lw-split">
          <div>
            <div class="bank">
              <div class="t">Bank Details</div>
              <div class="row"><span class="k">Name</span><span class="v"><b>:</b>&nbsp; ${esc(CFG.bankName)}</span></div>
              <div class="row"><span class="k">Branch</span><span class="v"><b>:</b>&nbsp; ${esc(CFG.bankBranch)}</span></div>
              <div class="row"><span class="k">Account No.</span><span class="v"><b>:</b>&nbsp; ${esc(settings.bankAccount)}</span></div>
              <div class="row"><span class="k">IFSC Code</span><span class="v"><b>:</b>&nbsp; ${esc(settings.bankIfsc)}</span></div>
            </div>
            <div class="contact">
              <div>Mobile No.: ${esc(CFG.mobile)}</div>
              <div>Email: <a href="mailto:${esc(CFG.email)}">${esc(CFG.email)}</a></div>
              <div class="eway">EWAY BILL NO. ${esc(s.ewayBill)}</div>
            </div>
          </div>
          <div class="seal-col">(Common Seal)</div>
        </div>
      </div>
      <div class="lw-right">
        <div class="sum h65"><div class="lab bold"><span>Total Amount Before Tax</span><span>:</span></div><div class="val fit top">${fmt(t.taxable)}</div></div>
        <div class="sum h6"><div class="lab"><span>Add CGST</span><span>:</span></div><div class="val fit top">${fmt(t.cgst)}</div></div>
        <div class="sum h6"><div class="lab"><span>Add SGST</span><span>:</span></div><div class="val fit top">${fmt(t.sgst)}</div></div>
        <div class="sum h6"><div class="lab"><span>Add IGST</span><span>:</span></div><div class="val fit top">${fmt(t.igst)}</div></div>
        <div class="sum h6"><div class="lab bold"><span>Tax Amount GST</span><span>:</span></div><div class="val fit">${fmt(t.gst)}</div></div>
        <div class="sum h6"><div class="lab bold"><span>Total Amount After Tax</span><span>:</span></div><div class="val fit">${fmt(t.afterTax)}</div></div>
        <div class="blankrow"></div>
        <div class="sum h67"><div class="lab bold"><span>GST Payable on Reverse Charges :</span><span></span></div><div class="val">NIL</div></div>
        <div class="cert">Certified that the particulars given above are true and correct.</div>
        <div class="forco">For, ${esc(CFG.companyName)}</div>
        <div class="sign">Authorized Signatory</div>
      </div>
    </div>

    <div class="foot"><span>${esc(CFG.footerNote)}</span><span>[E&amp;OE]</span></div>
  </div>

  <div class="wm">${esc(CFG.watermark)}</div>
</div>`;
  }

  // Shrink text that would overflow a cell, and size the empty space in the item table.
  function finishLayout(root) {
    root.querySelectorAll(".fit").forEach((el) => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize);
      let guard = 0;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > 6 && guard++ < 40) {
        size -= 0.5;
        el.style.fontSize = size + "px";
      }
    });
    const tbody = root.querySelector(".it tbody");
    const filler = root.querySelector(".it tr.filler");
    if (tbody && filler) {
      let used = 0;
      tbody.querySelectorAll("tr.item-row").forEach((tr) => { used += tr.offsetHeight; });
      const target = 54 * MM;
      filler.querySelectorAll("td").forEach((td) => { td.style.height = Math.max(0, target - used) + "px"; });
    }
  }

  const preview = document.getElementById("preview");
  const previewScale = document.getElementById("previewScale");
  function renderPreview() {
    const c = compute();
    preview.innerHTML = renderInvoice(c);
    finishLayout(preview);
    scalePreview();
    updateItemTotals(c);
  }
  function scalePreview() {
    const wrap = previewScale.parentElement;
    const scale = Math.min(1, wrap.clientWidth / (210 * MM));
    previewScale.style.transform = "scale(" + scale + ")";
    previewScale.style.height = preview.offsetHeight * scale + "px";
  }

  // ------------------------------------------------------------ item editor
  const itemsEl = document.getElementById("items");

  function renderItems(focusIndex) {
    itemsEl.innerHTML = state.items.map((it, i) => `
      <div class="item" data-i="${i}">
        <div class="item-no">${i + 1}</div>
        <div class="item-body">
          <div class="item-row1">
            <div class="field"><label>Name of Product/Service</label><textarea rows="1" data-k="name" maxlength="120">${esc(it.name)}</textarea></div>
            <div class="field"><label>HSN/ACS</label><input data-k="hsn" data-rule="digits" maxlength="5" inputmode="numeric" value="${esc(it.hsn)}"></div>
            <div class="field"><label>UDM</label><select data-k="udm">${UDM_OPTIONS.map((u) => `<option${u === it.udm ? " selected" : ""}>${u}</option>`).join("")}</select></div>
          </div>
          <div class="item-row2">
            <div class="field"><label>Qty</label><input data-k="qty" data-rule="digits" maxlength="20" inputmode="numeric" value="${esc(it.qty)}"></div>
            <div class="field"><label>Rate (₹)</label><input data-k="rate" data-rule="decimal" maxlength="15" inputmode="decimal" value="${esc(it.rate)}"></div>
            <div class="field"><label>CGST %</label><input data-k="cgst" data-rule="percent" maxlength="6" inputmode="decimal" value="${esc(it.cgst)}"></div>
            <div class="field"><label>SGST %</label><input data-k="sgst" data-rule="percent" maxlength="6" inputmode="decimal" value="${esc(it.sgst)}"></div>
            <div class="field"><label>IGST %</label><input data-k="igst" data-rule="percent" maxlength="6" inputmode="decimal" value="${esc(it.igst)}"></div>
          </div>
          <div class="item-foot">
            <span>Taxable: <b data-out="taxable">—</b> &nbsp;·&nbsp; Total: <b data-out="total">—</b></span>
            ${state.items.length > 1 ? '<button type="button" class="item-del" data-del>Remove</button>' : ""}
          </div>
        </div>
      </div>`).join("");
    itemsEl.querySelectorAll("textarea").forEach(autoGrow);
    if (focusIndex != null) {
      const t = itemsEl.querySelector(`.item[data-i="${focusIndex}"] [data-k="name"]`);
      if (t) { t.focus(); t.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }
  }
  function autoGrow(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; }

  function updateItemTotals(c) {
    const fmt = (v) => v == null ? "—" : "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    itemsEl.querySelectorAll(".item").forEach((el) => {
      const it = state.items[+el.dataset.i];
      const r = c.rows.find((x) => x.it === it);
      el.querySelector('[data-out="taxable"]').textContent = fmt(r ? r.taxable : null);
      el.querySelector('[data-out="total"]').textContent = fmt(r ? r.total : null);
    });
  }

  function addItem(afterIndex) {
    const prev = state.items[afterIndex];
    state.items.splice(afterIndex + 1, 0, blankItem(prev));
    renderItems(afterIndex + 1);
    changed();
  }

  itemsEl.addEventListener("input", (e) => {
    const el = e.target, k = el.dataset.k;
    if (!k) return;
    applyRule(el);
    if (el.tagName === "TEXTAREA") {
      const lines = el.value.split("\n");
      if (lines.length > 3) el.value = lines.slice(0, 3).join("\n");
      autoGrow(el);
    }
    state.items[+el.closest(".item").dataset.i][k] = el.value;
    changed();
  });
  itemsEl.addEventListener("change", (e) => {
    const el = e.target;
    if (el.tagName === "SELECT" && el.dataset.k) {
      state.items[+el.closest(".item").dataset.i][el.dataset.k] = el.value;
      changed();
    }
  });
  itemsEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    if (!e.target.dataset.k) return;
    e.preventDefault();
    const i = +e.target.closest(".item").dataset.i;
    if (i === state.items.length - 1) addItem(i);
    else renderItems(i + 1);
  });
  itemsEl.addEventListener("click", (e) => {
    if (!e.target.hasAttribute("data-del")) return;
    const i = +e.target.closest(".item").dataset.i;
    state.items.splice(i, 1);
    renderItems();
    changed();
  });
  document.getElementById("btnAddItem").addEventListener("click", () => addItem(state.items.length - 1));

  // ------------------------------------------------------------- main form
  const form = document.getElementById("form");

  function loadForm() {
    form.querySelectorAll("[data-f]").forEach((el) => { el.value = state[el.dataset.f] || ""; });
    form.querySelectorAll("[data-s]").forEach((el) => { el.value = settings[el.dataset.s] || ""; });
    form.querySelectorAll('input[name="poType"]').forEach((r) => { r.checked = r.value === state.poType; });
    form.querySelectorAll('input[name="reverseCharge"]').forEach((r) => { r.checked = r.value === state.reverseCharge; });
    document.getElementById("sameAsBill").checked = !!state.sameAsBill;
    syncVisibility();
    renderItems();
  }
  function syncVisibility() {
    document.getElementById("poNumberField").hidden = state.poType !== "Written";
    const ship = document.getElementById("shipFields");
    ship.querySelectorAll("input, textarea").forEach((el) => { el.disabled = state.sameAsBill; });
    ship.style.opacity = state.sameAsBill ? 0.5 : 1;
  }

  form.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.f) {
      applyRule(el);
      limitLines(el);
      state[el.dataset.f] = el.value;
      el.classList.remove("bad");
      changed();
    } else if (el.dataset.s) {
      applyRule(el);
      settings[el.dataset.s] = el.value;
      store.set(SETTINGS_KEY, settings);
      changed();
    }
  });
  form.addEventListener("change", (e) => {
    const el = e.target;
    if (el.name === "poType" || el.name === "reverseCharge") {
      state[el.name] = el.value;
      syncVisibility();
      changed();
      if (el.value === "Written") document.getElementById("poNumber").focus();
    } else if (el.id === "sameAsBill") {
      state.sameAsBill = el.checked;
      syncVisibility();
      changed();
    } else if (el.dataset.f) {
      state[el.dataset.f] = el.value;
      changed();
    }
  });

  let saveTimer = null;
  function changed() {
    renderPreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(DRAFT_KEY, state), 300);
  }

  // ------------------------------------------------------------- validation
  const errorsEl = document.getElementById("errors");
  function validate() {
    const problems = [];
    const mark = (field) => { const el = form.querySelector(`[data-f="${field}"]`); if (el) el.classList.add("bad"); };
    if (!state.invoiceNo.trim()) { problems.push("Invoice No. is empty"); mark("invoiceNo"); }
    if (!state.invoiceDate) { problems.push("Invoice Date is empty"); mark("invoiceDate"); }
    if (state.poType === "Written" && !state.poNumber) { problems.push("PO is Written but the PO number is empty"); mark("poNumber"); }
    if (!state.billName.trim()) { problems.push("Receiver name is empty"); mark("billName"); }
    const c = compute();
    if (!c.rows.length) problems.push("Add at least one product");
    c.rows.forEach((r, i) => {
      if (!r.it.name.trim()) problems.push(`Item ${i + 1}: product name is empty`);
      if (r.qty == null) problems.push(`Item ${i + 1}: Qty is empty`);
      if (r.rate == null) problems.push(`Item ${i + 1}: Rate is empty`);
    });
    if (problems.length) {
      errorsEl.innerHTML = "<b>Please fix these before generating the invoice:</b><ul>" +
        problems.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>";
      errorsEl.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return false;
    }
    errorsEl.hidden = true;
    return true;
  }

  // ----------------------------------------------------------------- output
  function fileName() {
    const no = (state.invoiceNo || "draft").replace(/[^A-Za-z0-9-]+/g, "_");
    return `Invoice_${no}_${fmtDate(state.invoiceDate)}.pdf`;
  }

  document.getElementById("btnPdf").addEventListener("click", async () => {
    if (!validate()) return;
    if (typeof html2pdf === "undefined") {
      alert("The PDF tool couldn't load (are you offline?). Use Print → Save as PDF instead.");
      return;
    }
    const btn = document.getElementById("btnPdf");
    btn.disabled = true; btn.textContent = "Generating…";
    const stage = document.getElementById("pdfStage");
    stage.innerHTML = renderInvoice(compute());
    finishLayout(stage);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await html2pdf().set({
        margin: 0,
        filename: fileName(),
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 3, backgroundColor: "#ffffff", useCORS: true, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all"] }
      }).from(stage.firstElementChild).save();
    } finally {
      stage.innerHTML = "";
      btn.disabled = false; btn.textContent = "Download PDF";
    }
  });

  document.getElementById("btnPrint").addEventListener("click", () => {
    if (!validate()) return;
    const area = document.getElementById("printArea");
    area.innerHTML = renderInvoice(compute());
    area.style.display = "block";
    area.style.position = "fixed"; area.style.left = "-10000px";
    finishLayout(area);
    area.removeAttribute("style");
    const old = document.title;
    document.title = fileName().replace(/\.pdf$/, "");
    window.print();
    document.title = old;
  });

  document.getElementById("btnNew").addEventListener("click", () => {
    if (!confirm("Start a new invoice? The current form will be cleared.")) return;
    state = blankState();
    store.remove(DRAFT_KEY);
    errorsEl.hidden = true;
    form.querySelectorAll(".bad").forEach((el) => el.classList.remove("bad"));
    loadForm();
    renderPreview();
  });

  window.addEventListener("resize", scalePreview);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderPreview);

  // expose for testing
  window.BizQuick = { amountInWords, compute, getState: () => state };

  loadForm();
  renderPreview();
})();
