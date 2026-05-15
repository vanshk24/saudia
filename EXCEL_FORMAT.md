# Excel Output File — Format & Structure

## File Info
- Format: .xlsx
- Example filename: LPC_-SV37-23MAR.xlsx
- One sheet only: Sheet1
- Row 1 = Headers
- Row 2 onwards = One row per passenger

---

## Column Structure (in exact order)

| Column # | Header | Description | Example |
|----------|--------|-------------|---------|
| 1 | PNR | 6-character booking reference number | 9737GJ |
| 2 | First T | First flight date | 25-Mar-2026 |
| 3 | From | First flight origin airport code | RUH |
| 4 | To | First flight destination airport code | IAD |
| 5 | Second T | Return or connecting flight date | 01-Apr-2026 |
| 6 | From | Second flight origin airport code | SFO |
| 7 | To | Second flight destination airport code | RUH |
| 8 | Third T | Third leg flight date (blank if no 3rd leg) | |
| 9 | From | Third leg origin (blank if no 3rd leg) | |
| 10 | To | Third leg destination (blank if no 3rd leg) | |
| 11 | Fourth T | Fourth leg flight date (blank if no 4th leg) | |
| 12 | From | Fourth leg origin (blank if no 4th leg) | |
| 13 | To | Fourth leg destination (blank if no 4th leg) | |
| 14 | Full Name | Full passenger name as on booking | Mr. Raed Al Luhayb |
| 15 | Last Name | Last name only | Al Luhayb |
| 16 | FF. No. | Frequent Flyer number (blank if none) | SV 78915244 |
| 17 | Class | Travel class code(s) | F |
| 18 | Ticket No. | Airline ticket number | 065-2193325921 |
| 19 | Passport No. | Passport number (blank if not available) | D181510 |

---

## Status Columns (to be added by automation)

| Column # | Header | Values |
|----------|--------|--------|
| 20 | Status | ✅ Done / ⚠️ No Passport / ❌ Skipped |
| 21 | Skip Reason | Blank if done, reason text if skipped |

---

## Row Color Coding (applied by automation)

| Color | Meaning |
|-------|---------|
| 🟢 Green | Passenger fully processed successfully |
| 🟡 Yellow | Processed but passport number missing |
| 🔴 Red | Skipped — missing critical information |

---

## Real Data Examples

### Example 1 — Single passenger, full data
| PNR | First T | From | To | Second T | From | To | Full Name | Last Name | FF. No. | Class | Ticket No. | Passport No. |
|-----|---------|------|----|----------|------|----|-----------|-----------|---------|-------|------------|--------------|
| 9737GJ | 25-Mar-2026 | RUH | IAD | | | | Mr. Raed Al Luhayb | Al Luhayb | SV 78915244 | F | 065-2193325921 | D181510 |

### Example 2 — Round trip, no frequent flyer
| PNR | First T | From | To | Second T | From | To | Full Name | Last Name | FF. No. | Class | Ticket No. | Passport No. |
|-----|---------|------|----|----------|------|----|-----------|-----------|---------|-------|------------|--------------|
| 7V45JW | 23-Mar-2026 | RUH | SFO | 01-Apr-2026 | SFO | RUH | Mr. Mohammed Alhajlah | Alhajlah | | F | 065-2195734165 | ZU59015 |

### Example 3 — Group booking, 2 passengers, one missing passport
| PNR | First T | From | To | Second T | From | To | Full Name | Last Name | FF. No. | Class | Ticket No. | Passport No. |
|-----|---------|------|----|----------|------|----|-----------|-----------|---------|-------|------------|--------------|
| 8OZLY9 | 23-Mar-2026 | RUH | IAD | 13-Apr-2026 | IAD | RUH | Ms. Njlaa Khaled Alsabaan | Alsabaan | | F | 065-2193701092 | AA76326 |
| 8OZLY9 | 23-Mar-2026 | RUH | IAD | 13-Apr-2026 | IAD | RUH | Mrs. Suheila Ali Alkandil | Alkandil | | F | 065-2193701091 | _(blank)_ |

### Example 4 — Group booking, 3 passengers, same PNR
| PNR | First T | From | To | Second T | From | To | Full Name | Last Name | FF. No. | Class | Ticket No. | Passport No. |
|-----|---------|------|----|----------|------|----|-----------|-----------|---------|-------|------------|--------------|
| 8KSX7F | 23-Mar-2026 | RUH | IAD | 15-Apr-2026 | IAD | RUH | Mr. Mohammed Almineefi | Almineefi | SV 98478693 | A | 065-2192136708 | BS85253 |
| 8KSX7F | 23-Mar-2026 | RUH | IAD | 15-Apr-2026 | IAD | RUH | Mrs. Shahad Aleeban | Aleeban | SV 1000470327 | | 065-2192136706 | BT28947 |
| 8KSX7F | 23-Mar-2026 | RUH | IAD | 15-Apr-2026 | IAD | RUH | Abdullah Almineefi | Almineefi | SV 1000623945 | | 065-2192136707 | Z979524 |

---

## Important Notes for Automation

1. **Multiple ticket numbers** — some rows have comma-separated ticket numbers (e.g. `065-7366390279,065-7366390275`). Write all of them in the Ticket No. cell as-is.
2. **Multiple class codes** — some passengers have comma-separated classes (e.g. `F,F` or `J,J`). Write as-is.
3. **Date formats** — some dates come as proper dates, some as text like `23 Mar`. Normalize all to DD-Mon-YYYY format in output.
4. **Blank cells** — never write the word "null" or "None". Leave the cell completely blank if data is missing.
5. **PNR repeats** — same PNR appears multiple times for group bookings. This is correct. Each passenger gets their own row but shares the same PNR and flight details.
