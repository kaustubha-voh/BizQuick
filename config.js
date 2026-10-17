/*
 * BizQuick — fixed company details.
 * Everything here prints on every invoice and never changes per invoice.
 * Edit this file if your company details change.
 *
 * NOTE: This repository is public. Do NOT put your bank account number or
 * IFSC code here — enter them in the app under "Bank details" instead.
 * They are saved only in your own browser.
 */
window.BIZQUICK_CONFIG = {
  companyName: "BILLSONS INDIA",
  companyAddress: "5C/26, New Rohtak Road, New Delhi - 110005 (INDIA)",
  gstNo: "07AACPV5493L1Z0",
  watermark: "Billsons India",

  bankName: "KOTAK MAHINDRA BANK",
  bankBranch: "Arya Samaj Road, Karol Bagh",

  mobile: "9818920149",
  email: "billsonsindia@gmail.com",

  footerNote: "Interest @18% P. A. shall be charged beyond 30 days",

  // Pre-filled value for the State Code next to "State" (can be changed per invoice)
  defaultStateCode: "07"
};
