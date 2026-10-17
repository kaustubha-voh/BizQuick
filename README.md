# BizQuick

PDF invoice generator for **BILLSONS INDIA**. Fill in a form, see the invoice update live in the exact company template, and download it as an A4 PDF.

## How to use

**Online:** open https://kaustubha-voh.github.io/bizquick/ (once GitHub Pages is enabled — see below).

**On your computer:** download this repo (green **Code** button → **Download ZIP**), unzip it, and double-click `index.html`. It opens in your browser; nothing to install.

1. Fill in the invoice, transport, receiver and consignee details.
2. Add products. Press **Enter** to move to the next item (a new row is added automatically). **Shift+Enter** adds a second line to a product name, e.g. `(02 Drums)`.
3. Click **Download PDF**. You can also use **Print** and choose *Save as PDF* (this works offline too).

The form is saved automatically in your browser, so a refresh won't lose your work. **New invoice** clears it.

### First-time setup: bank details

Open **Bank details** at the bottom of the form and enter the account number and IFSC code once. They're stored only in your browser, not in this public repository.

## What the app does

| Field | Input |
|---|---|
| PO No. | Verbal / Written (written → number, max 10 digits) |
| Vendor Code | Always struck off |
| Transportation Mode | Air / Ship / Road |
| Vehicle Number | Letters & digits, max 20 |
| Date of Supply, Invoice Date | Date picker, printed as DD-MM-YYYY |
| Place of Supply, State | Letters, max 20 |
| Reverse Charge | Yes / No (the other option is struck off) |
| Invoice No. | Free text incl. special characters |
| Receiver / Consignee | Name, address (4 lines), state, state code, GSTIN; "Same as Billed to" option |
| HSN/ACS | Digits, max 5 |
| UDM | Ltr / Kgs / Pcs / Drums |
| Qty | Whole number, max 20 digits |
| Rate | Decimal |
| CGST / SGST / IGST | Rate % per item; an empty rate means that tax isn't charged |

Calculated automatically: Taxable Value (Qty × Rate), each tax amount (rate % of taxable value), row Total, the TOTAL row, Total Amount Before Tax, Add CGST/SGST/IGST, Tax Amount GST, Total Amount After Tax, and the amount in words (Indian system: lakh, crore, paise).

## Changing fixed details

Company name, address, GST number, bank name/branch, phone, email and the footer note are in [`config.js`](config.js).

## Enabling the online link (GitHub Pages)

Repo **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**. After a minute the app is live at https://kaustubha-voh.github.io/bizquick/.

## Files

- `index.html` — page and form
- `app.js` — validation, calculations, invoice rendering, PDF/print
- `style.css` — app styling and the invoice template layout
- `config.js` — fixed company details
