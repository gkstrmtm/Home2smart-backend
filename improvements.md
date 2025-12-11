You are the dev agent responsible for **fixing the Home2Smart “Bundles” purchase → schedule → order history flow** and the **custom quote digestion logic**.

Stop inventing new UI or half-fixes. The UI is mostly there. The problem is correctness, data flow, and mobile behavior.

Your job in this pass is to **audit and repair everything around:**

1. Cart + discounts for bundles
2. Custom quote digestion (including mount selection logic)
3. Schedule widget (calendar + time window)
4. Order confirmation + previous orders display
5. How all of that writes to / reads from the backend

Do not touch unrelated pages.

---

## 0. Ground rules

* Work in the existing stack (Stripe checkout + whatever backend is running under `home2smart.com`).
* Use the **terminal, devtools, and logs**. This is debugging, not guessing.
* Do not add “diagnostic buttons” to the UI. Use console logs and back-end logs instead.
* Keep the current visual style. Only change layout/markup when necessary to fix issues or make mobile sane.

---

## 1. Fix cart + discount logic for bundles

Right now the cart math and discount handling are not bulletproof.

**Goals**

* Cart totals are always correct.
* Discounts always apply when they should, never when they shouldn’t.
* No raw JSON or internal data ever leaks into the UI.

**Tasks**

1. **Trace the pricing pipeline**

   * Find the source of truth for:

     * Base bundle prices
     * Add-on prices
     * Any discount rules (percent, fixed, multi-item, etc.)
   * Confirm there is **one canonical price per item** coming from the backend or config, not “magic numbers” scattered in the frontend.

2. **Normalize cart data**

   * Whatever structure you store (likely JSON from the “Items” field in the screenshot), define a strict schema, for example:

     ```ts
     type CartItem = {
       type: "package" | "addon" | "custom_quote";
       service_code: string;
       label: string;
       qty: number;
       unit_price: number;
       discount_code?: string | null;
       discount_amount?: number;
       subtotal: number;
     };
     ```

   * Ensure the **cart total is computed from this structure only**, on both:

     * The backend (for Stripe / order storage)
     * The frontend (for display)

3. **Discount rules**

   * Implement a single function that:

     * Takes the cart items
     * Applies all discount rules in a deterministic order
     * Returns:

       * adjusted line items
       * `discount_total`
       * `grand_total`
   * Guardrails:

     * No stacking the same discount twice.
     * If a rule depends on quantity or combination, validate that explicitly.
     * If user manipulates the DOM, the backend still refuses invalid discounts.

4. **Order confirmation / previous orders totals**

   * Whatever total you show in:

     * Order confirmation page
     * “Previous orders” card
   * Must be **the exact same value** that was charged (or is expected to be charged) via Stripe.
   * Use the backend “order” record as the source, not a fresh recompute from possibly stale JSON.

5. **Testing for cart/discounts**

   * In a dev environment, run **several complete checkouts**:

     * Bundle only
     * Bundle + multiple add-ons
     * Whatever discount scenarios exist
   * Verify with:

     * Frontend cart total
     * Stripe payment (amount)
     * Stored order record
     * “Previous orders” display
   * They must all match down to the cent.

---

## 2. Make custom quote digestion fully robust (including mount selection)

There is a **custom quote flow** that feeds into the cart/order system. It now supports more detailed mount selection (different mount types, sizes, combinations, etc.). This logic must be upgraded and made bulletproof.

**Goals**

* Any custom quote produced by the quote builder is correctly translated into normalized cart items.
* Mount selection and other structured options are interpreted intelligently and consistently.
* Pricing for custom quotes matches the same rules as standard bundles, including discounts, taxes (if any), and totals.

**Tasks**

1. **Locate the custom quote ingestion path**

   * Find where quote builder output is:

     * Created on the frontend
     * Posted to the backend
     * Converted into `CartItem` records and/or order items.
   * Identify the exact shape of the quote payload (fields for service codes, mount type, size, quantity, options, etc.).

2. **Define a stable mapping from quote → cart items**

   * Build a deterministic mapping layer that:

     * Reads the quote payload
     * Validates it against known service codes / mount types
     * Emits one or more `CartItem` objects per quote.
   * Examples:

     * A “TV Mounting 55–75" with full-motion mount included” quote should map to a clear service_code and price, not a free-form text blob.
     * If a mount is “customer provided” vs “Home2Smart provided”, that must be represented explicitly and priced correctly.

3. **Handle mount selection intelligently**

   * Ensure custom quote logic is aware of:

     * Screen size ranges
     * Mount type (`tilt`, `fixed`, `full_motion`, etc.)
     * Whether the mount is included vs BYO
     * Any constraints like extra fees for larger sizes or certain mount types.
   * Use a **single mount-pricing table/config** that both the quote builder and the cart use, to avoid divergence.

4. **Validate and sanitize quote data**

   * Reject or correct impossible combinations (e.g., unsupported mount type or size).
   * Never let raw quote JSON leak into the UI (no blobs in Previous Orders).
   * If a quote payload is malformed, log it and surface a safe, human-readable fallback in the UI.

5. **End-to-end tests for custom quotes**

   * In dev, run multiple realistic custom quotes:

     * Different mount types and sizes
     * Mixed items (TV + cameras) if supported
     * With and without discounts
   * For each quote:

     * Confirm cart display is correct
     * Confirm Stripe charge matches
     * Confirm Previous Orders and Order Details show clean, human-readable items
     * Confirm schedule + payouts (later systems) see the correct values.

---

## 3. Fix order confirmation + previous orders display

From the screenshots:

* “Total Paid” shows `$0.00 USD` on the confirmation page.
* “Items” under previous orders is dumping raw JSON blobs.
* “Service date” is showing a placeholder icon / invalid glyph instead of a readable date.

**Goals**

* Confirmation and history views should feel like a real consumer app, not a debug panel.

**Tasks**

1. **Order confirmation page**

   * Use the actual order record returned after checkout.
   * Show:

     * `Order ID` (human-readable ID or short token, not a long Stripe session string unless that’s a deliberate choice)
     * `Total Paid` using the **charged amount**, not a local default.
     * `Items` as a human list:

       * One line per item: `2 × Camera Package – $X.xx`.
       * Never raw JSON.

2. **Previous orders section**

   * Parse the stored items JSON into a **clean, readable format**:

     * Service name, quantity, and price per line.
     * If there are multiple items, display them as a vertical list.
   * Fix “Service date”:

     * Use the scheduled installation datetime if it exists.
     * Format as `Dec 9, 2025 – 9:00 AM–12:00 PM` or similar.
     * If no date is scheduled yet, show `Not scheduled` instead of a broken icon.

3. **Shared component**

   * Use a **shared formatting utility** for order items and dates so that:

     * Confirmation page
     * Previous orders
     * Any future “Order details” view
   * All show the same clean representation.

4. **Guard against missing data**

   * If the order exists but items data is missing or malformed:

     * Log it with a clear message.
     * Show a fallback like `Items unavailable` instead of raw JSON.

---

## 4. Fix the scheduler calendar + “Invalid Date” issues

From the screenshots:

* The calendar popup is clunky on mobile.
* “Confirm Appointment” is giving `Failed to schedule: Invalid Date`.
* There is a full calendar and time window selection, but submission fails or behaves inconsistently.

**Goals**

* Customer can always:

  * Pick a valid date
  * Pick a valid time window
  * Submit once
  * Get a **successful schedule** associated with their order
* The entire interaction is smooth on mobile.

**Tasks**

1. **Trace the scheduling flow**

   * Find where the appointment is stored:

     * Table/collection/schema name
     * Fields for date, time window, timezone, order id, customer id.
   * Locate the API endpoint/function that the “Confirm Appointment” button calls.

2. **Fix date parsing / validation**

   * Identify why `Invalid Date` is happening:

     * Timezone mismatch?
     * Using client locale to parse a non-ISO string?
     * Backend expecting `YYYY-MM-DD` but receiving something else?
   * Normalize:

     * Use `YYYY-MM-DD` for date.
     * Use a fixed set of time window identifiers (e.g. `9_12`, `12_3`, `3_6`).
   * On the backend:

     * Validate that:

       * Date is in the future (or at least not in the past).
       * Date is within allowed scheduling range.
       * Time window is one of the allowed values.
     * If validation fails, return a **clear error code/message** that is displayed nicely in the UI.

3. **UI behavior (mobile)**

   * Ensure the calendar:

     * Fits in viewport without weird overflow.
     * Allows vertical scrolling if needed.
     * Keeps the “Confirm Appointment” button visible or easy to reach.
   * When an appointment is successfully scheduled:

     * Show a clear success state.
     * Disable or hide “Confirm Appointment” or change label to `Reschedule`.

4. **Persist and reflect scheduled date**

   * After scheduling:

     * Order record must now include the scheduled date/time window.
   * On:

     * Order confirmation
     * Previous orders
   * Show that date/time window clearly.

5. **Rescheduling**

   * If the design allows customers to change dates:

     * When they pick a new date + window and confirm:

       * Overwrite previous schedule entry.
       * Make sure this also updates the backend and any dispatch view.

6. **Testing for scheduler**

   * Use devtools and terminal logs to:

     * Submit a handful of schedule requests with the calendar.
     * Confirm:

       * API receives the correct normalized values.
       * No `Invalid Date` errors.
       * DB rows are created/updated.
       * UI updates immediately.

---

## 5. Data flow + logging (how to actually debug this)

Do NOT “guess” the fix. Prove it.

1. **Use terminal + devtools**

   * Run the project in dev mode.
   * In the browser:

     * Open Network tab.
     * Watch the **checkout**, **schedule**, and **order fetch** requests.
   * In the terminal:

     * Log the payloads and results around:

       * Order creation
       * Discount application
       * Schedule creation/update
       * Custom quote digestion

2. **Add targeted logging**

   * On the backend, around the schedule endpoint:

     * Log incoming body: date, time window, order id, user id.
     * Log parsed date object and any validation decision.
   * Around order retrieval:

     * Log what items and totals are being pulled.
     * Log any mismatch between stored payment amount and displayed total.
   * Around custom quote ingestion:

     * Log the raw quote payload.
     * Log the normalized `CartItem` objects you derive from it.

3. **End-to-end sanity checks**

   * Run **at least 3 full flows**:

     1. Add a bundle, pay, schedule, check order history.
     2. Add bundle + add-ons + discount, pay, schedule, check order history.
     3. Submit a custom quote with mount selection, convert to order, pay, schedule, check order history.
   * For each:

     * Confirm totals
     * Confirm schedule is stored and visible
     * Confirm no raw JSON displays
     * Confirm there are no console errors.

---

## 6. Mobile optimization checklist (bundles + scheduler flow only)

While you work, keep these constraints:

* No horizontal scrolling on standard mobile widths.
* Card padding and font sizes should match the existing design language.
* Modals / calendars must:

  * Fit vertically where possible.
  * Fall back to vertical scrolling instead of clipping content.
* Buttons must be:

  * Full-width or clearly tap-able.
  * Consistent in height and typography across the flow.
* No emoji in labels unless explicitly requested.

---

## 7. Deliverables

When you are done, you should be able to say:

1. “Cart totals and discount behavior are fully consistent across checkout, confirmation, and previous orders.”
2. “Custom quote digestion, including mount selection, reliably maps into normalized cart items and correct pricing.”
3. “The scheduler no longer throws `Invalid Date` and correctly stores + shows the appointment.”
4. “Previous orders and order confirmation show clean, human-readable data, not raw JSON.”
5. “All changes have been verified with real test orders in dev, using logs and devtools, not guesswork.”

Do not stop at “it looks right”. Prove it with actual data and test runs.
