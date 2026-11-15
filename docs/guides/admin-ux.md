# Admin UX conventions

Keep these settled choices consistent when changing the admin interface.

- Use strong selected styling only for the checkout payment/mode track, including Split. Use subtle styling for other choices, filters and chips. Cash quick amounts use a light fill and ring so Confirm stays prominent.
- Put secondary explanations behind the information disclosure. Keep required context, validation, amounts and primary actions visible.
- Receipt-line Refund is a neutral ghost button; Link appointment is outlined. Refund forms retain the order number and service context.
- The hotel month grid grows with its content and uses page scrolling. Show “+N more” only when content actually overflows.
- Coupon editing uses one column, capped at `max-w-3xl`. Show the summary below a valid discount. The line-discount placeholder is “0%”.
- Team settings are left-aligned and capped at `max-w-4xl`. Reserve the actions column on every row. Pending invitations use an amber expiry badge; expired invitations use the destructive tone.
- Mark arrived sits beside the appointment status. Label money taken elsewhere “Record external payment…” with an information disclosure on both stay and appointment sheets.
- Show “Covered” only when every split-payment row has an amount. The server decides approval validity; the client displays expiry without blocking based on its own clock.
- Guard unsaved drafts on in-app navigation and reload/close. Do not invent browser history entries to intercept Back/Forward.
- Business settings show a sticky save bar only when dirty or after a failed save. If defaults are in use, state that once in History with a secondary Save defaults action.
- New booking places Block these dates instead below the dates as a ghost action with the Ban icon. Its footer contains Total and Create booking.
- Phone order headers keep one row: truncating title, visible Coupon label, more menu and close. Hide the decorative receipt icon.
- Phone chat headers use two rows: navigation, guest, information and actions first; status, channel/property and No reply needed second. Show one Needs you badge; the automation chip appears only while AI is paused or replying.
- Missing-information property names wrap on phones. Phone refund-method choices use one subtle five-option track.
