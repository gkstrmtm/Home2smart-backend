You are updating the Home2Smart Pro Portal front-end.
Your job is to bring the mobile experience up to the same standard as desktop and fix layout bugs.
Do not change the desktop layout or color palette. Only refine styles and layout at mobile breakpoints.

Brand + layout rules

This is dark, minimal UI.

Keep the existing palette: deep navy background, bright Home2Smart blue as the primary CTA, purple as secondary, white/near-white text.

Do not introduce washed-out blues, greys, greens, or golds.

Use rounded corners and soft shadows, not sharp boxes.

Mobile breakpoint to target: @media (max-width: 768px); design should look tight at ~360–400px width.

Cards should feel compact:

horizontal padding ~16px, vertical padding ~12–16px

consistent 12–16px gap between stacked elements

no unnecessary empty vertical space.

When you finish, visually compare desktop vs mobile and make sure colors, button treatments, radius, and typography feel like the same product.

1. Customers tab (Upcoming Appointments cards)

Goal: make the customer cards feel tighter and less boxy.

Requirements

Reduce overall card height on mobile. Remove any hardcoded min-height that makes them huge. Let content drive height.

Use a single consistent radius for all cards and buttons inside them so they don’t look like unrelated blocks.

Tighten vertical spacing:

Name + role at top

Service, address, amount stacked with small gaps

Notes and actions grouped together

Rebalance buttons:

Call Customer remains the primary CTA: full-width or nearly full-width, but not edge-to-edge with zero breathing room.

Reschedule uses the secondary style and is visually subordinate.

Make sure icons and labels in these buttons are perfectly vertically centered and not cramped against the edges.

Check this screen on a 360px wide viewport and adjust until each customer card reads clearly without feeling like a tall column of empty air.

2. Hamburger menu / nav drawer

The current drawer looks like a stack of giant, boxy pills and wastes vertical space.

Requirements

Reduce the height of each menu item at mobile. These should read like a simple, clean list, not big CTA cards.

Use consistent spacing between menu items, and keep left/right padding comfortable but not excessive.

Keep the same nav order and labels (Dashboard, Customers, Schedule, Payouts, Reviews, Training, Account, Sign out).

The “Close” button at the bottom should:

Be visually distinct as a secondary action

Not be oversized or taller than menu items

Stay fully visible on small screens without forcing extra scrolling.

Test by opening the menu on a 360px viewport and confirm items are readable, not cramped, and the drawer does not feel like a stack of blunt rectangles.

3. Reviews tab (No reviews yet state)

Right now, there is a tiny card near the top and then a huge empty column of navy.

Requirements

Center the empty-state card vertically within the viewport on mobile when there are no reviews.

The card should be a single, clean panel with:

Heading / short description

A centered “No reviews yet” message

Remove excess bottom padding so the user doesn’t scroll through dead space.

Make sure that when reviews DO exist later, the layout gracefully shifts to a list view without layout jank.

4. Payouts / Earnings dashboard scroll bug

On mobile, the user cannot scroll the full page. Content extends past the bottom of the screen but is not reachable.

Requirements

Identify and remove the cause of blocked scrolling:

Look for any container (body, html, .main, .content, page wrapper) that uses:

height: 100vh; or fixed heights

overflow: hidden; or overflow-y: hidden;

Ensure that on mobile:

body / html use min-height: 100% rather than forcing 100vh in a way that clips content

The scrollable area is the main content wrapper, not a nested element that cuts off content.

Verify on a 360px viewport that the user can scroll from the top of the “Available Balance” section down through Lifetime, This Week, Pending Approval, and any footer or help text.

Keep the current visual design. This is a layout / overflow fix, not a redesign.

5. Upcoming Jobs card and Job Details modal

The Upcoming Jobs card is almost correct but still slightly off, and the full job details overlay feels heavy and “desktop-sized”.

Upcoming Jobs card

Keep the “chip” at the top for the service name, but ensure:

Date and time are aligned cleanly on a single line or a clear two-line arrangement. No awkward wrapping like Dec 5 splitting strangely.

Compress vertical spacing around:

Service name / date / time

Amount

Primary On My Way button

Photos / Sign buttons

View details link

View details should sit at the bottom of the card, aligned and styled consistently with other “details” links. It should not look like a random extra block.

Job details modal

Reduce the vertical padding in the modal on mobile so it does not feel like a giant empty sheet.

Use a clear hierarchy:

Job title at top

Date/time

Address

Customer

Resources / included tech

Payout breakdown

Help / “Request Second Tech” section

Distance and Close button

Make the Close button visible without scrolling on most phones if possible, or ensure the scroll behavior is smooth and obvious.

Keep the styling consistent with the rest of the app in terms of colors and rounding.

6. Address / customer data correctness in job details

Currently the job details modal often shows:

Customer: Not provided

Address line appears stale or inconsistent with the job card

Requirements

Trace where the job details modal pulls its data for:

Customer name

Address

Align these fields with the same source used by the dashboard cards and schedule.
If the job card shows a proper address and customer, the modal must show the same values.

Only show “Customer: Not provided” when the underlying data is truly missing, not because the modal is looking at the wrong property or fallback.

Add basic defensive logic:

If a field is missing, show a clean placeholder (N/A) rather than a misleading phrase that suggests something is broken.

Document in comments where each field now comes from so it is easy to maintain.

7. Global mobile polish

Across all mobile views (Sign in, Dashboard, Customers, Schedule, Payouts, Reviews, Training, Account):

Ensure consistent:

Card width, radius, and padding

Button styles (primary, secondary, subtle)

Typography scale and line height

Remove any leftover “square wrapper” highlights around cards that create harsh rectangles.

Confirm everything is scrollable, nothing gets clipped, and there is no huge dead zone at the bottom of any screen.

Do not introduce new colors or playful icons. This is a professional, minimal, utility dashboard.

When done, summarize:

Which selectors / components you touched

Which layout bugs you fixed (especially scroll)

How you tested the mobile views (screen sizes, pages)

Make sure the changes are mobile-first, preserve the existing desktop layout, and keep visual parity so the app feels like one coherent brand.