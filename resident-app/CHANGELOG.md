# Trinize Resident — changelog

## 1.2.0 (build 3) — 16 Nov 2026

The remaining recommendations from the UX review that don't need the backend.

### Added
- **Needs your attention.** Important notices that still need acknowledging are pinned above the greeting on Home,
  and drop back into Announcements once acknowledged.
- **Report, Block, Copy, Delete.** A "⋯" menu on every post and comment. Report adds it to the moderation queue
  (one report per item; the author isn't told who reported). Block hides that resident's posts and comments;
  unblock from Profile → Privacy → Blocked residents. Your own posts and comments can be deleted.
- **Delete account** in Profile → Account status. In this build all data is on the phone, so this erases it for
  this number and signs out.
- **Download my data** now works: it exports your issues, posts, replies, votes, RSVPs, gratitude, settings and
  (if history is on) assistant questions as JSON through the phone's share sheet.
- **Report with a simple form.** A no-chat alternative from the + menu and from the chat ("Use a form instead"):
  problem, optional details, category (suggested from the text), place, urgency and an optional photo.
- **Photo before the preview.** The chat now asks "Add a photo?" before showing the issue preview; the photo is
  shown in the preview and attached to the ticket.
- **First-run tutorial.** After the first sign-in the screen dims and a spotlight steps over the real controls —
  pinned notices, the Assistant tab, the + button and My Issues — with a tip beside each (Back, Next, Skip;
  Android back skips). Steps whose control isn't on screen are left out. Replay from Profile → About → App tour.
  It waits until the number's saved data has loaded, so returning residents don't see it again.
- **Date and time picker** in Suggest an event (next three weeks, common time slots) instead of free text.
- **Tappable emergency numbers.** The assistant's emergency answer shows large call buttons for Security,
  Ambulance 108 and Fire 101.

### Fixed
- **#1 Critical — code screen keyboard, second pass.** The 1.1.0 retry could never fire: React Native skips
  `focus()` on an input it already counts as focused, and `autoFocus` marked it focused even when Samsung Keyboard
  ignored the request. The screen now asks for the keyboard after the slide-in ends (with 0.5 s and 1.2 s
  fallbacks), and if the input is focused but no keyboard is showing it blurs and re-focuses. The same applies to a
  tap on the boxes, after a wrong code and after Resend.
- **#5 Acknowledgement date.** The date is stored when you acknowledge; it used to show the current day every time.
- **#8 Notifications, polls and events.** Poll and event alerts (and new RSVP alerts) now open the list scrolled to
  that poll or event, outlined, instead of the top of the list.
- **Text size.** Labels the review measured at 10–11 sp are now 12 sp: issue timeline times, section headings,
  Home impact labels, the "Recent" heading on Your impact and the AI suggestion label. Status pills and tab labels
  are 11 sp.
- **#6 Helpful chats.** Clear assistant chat history now clears earlier sessions too, so the Home count drops to 0
  as the screen promises.

### Changed
- **Moderation rules.** Fair complaints about services are no longer flagged ("The T4 lift is useless, third
  breakdown this month" passes); insults aimed at people are ("Is he reliable or a scammer?" is now caught).
  Hindi, Hinglish and Kannada insults are covered.
- **Tone rewrite keeps the facts.** "The T4 lift is useless, third breakdown this month" becomes "Dear neighbours,
  the T4 lift is not working properly, third breakdown this month. Could we please get an update on this?"
- **Multilingual assistant.** Questions in Hindi, Hinglish and Kannada are understood ("paani kab band hoga",
  "पानी कब बंद होगा?", "ನೀರು ಯಾವಾಗ ನಿಲ್ಲುತ್ತದೆ", "मेरी शिकायत का स्टेटस", "aag lagi hai"). Answers are in English.
- **Polls close on their end date** even if nobody closes them.
- **Sign-in state** is kept in the Android Keystore-backed secure store, and Android backup is turned off.
- Home tile and album labels raised to 11–12 sp.

### Still open (needs the backend or a decision)
- Real SMS codes and SMS Retriever auto-read; data saved on the server; push notifications (needs a Firebase
  project and `google-services.json`); server-side moderation; answers in Hindi / Kannada.
- Account deletion on the web (needs a hosted page); Privacy Policy and Terms still need legal review and hosting.
- Release signing key: the APK is still signed with the debug certificate.
- Re-test at 1.3× and 1.5× system text size on a phone.

## 1.1.0 (build 2) — 16 Nov 2026

Response to the hands-on UX review of 1.0.0 (13 Nov 2026). Bug numbers match the review.

### Fixed
- **#1 Critical — code screen keyboard.** The code is now typed into a full-size input that lies over the six boxes
  (it used to be a 1×1 transparent field, which Samsung Keyboard refused to open for). It is focused again once the
  screen has finished sliding in, and tapping any box opens the keyboard. SMS autofill hints (`sms-otp`,
  `oneTimeCode`) are kept, so Gboard and Samsung Keyboard offer the code from the SMS.
- **#2 Calendar.** "Added to your calendar" only appears when the phone confirms a save (iOS). Android can't tell a
  save from a discard, so it says "Opened in your calendar"; Cancel shows nothing.
- **#3 Messages that over-promised.** Removed claims of an admin console, SMS download links, server checks,
  "admin team notified", SMS invites and future notifications. Every message now states only what happened.
- **#4 Data lost on sign-out.** Issues, votes, RSVPs, posts and settings are saved per mobile number on the phone.
  Signing out keeps them; signing back in with the same number restores them. (A different number starts fresh.)
- **#5 Stuck date.** Notices, events, polls, issues and timelines are dated relative to today. Events move to Past
  once they end, Upcoming is ordered by date, and acknowledgements are stamped with today's date.
- **#6 Numbers disagree.** "Gratitudes sent" and "Helpful chats" are counted from the records shown on the detail
  screen. "Posts held" now includes held replies.
- **#7 Earlier comments.** Comment counts match the real thread; "Show N earlier comments" expands the thread.
- **#8 Notifications.** The water notice opens the notice, ISS-1042 / ISS-1038 alerts open that issue, the gratitude
  alert opens your gratitudes; new issue alerts open the new issue.
- **#9 Privacy Policy and Terms.** Both links open readable pages (also under Profile → About).
- **#10 Home part-way down.** Home is held at the top while the sign-in keyboard closes.
- **#11 Copy.** The language preview uses the right greeting for the time of day; the number error now says
  "Mobile numbers have 10 digits and start with 6, 7, 8 or 9".

### Changed
- Sign out asks for confirmation first.
- Demo-only content (code banner, guided tour) sits behind `EXPO_PUBLIC_DEMO`; build with `EXPO_PUBLIC_DEMO=off`
  to hide it. The "try the word useless" placeholder and the internal-brief reference are gone.
- Secondary text darkened from #918CAB to #6E6890; metadata is at least 12 sp.
- Reaction chips have a 48 dp touch target.
- The Assistant tab no longer shows a back arrow.
- Seasonal demo content (Onam, Independence Day, monsoon) replaced with year-round items.
- Removed unused Android permissions: microphone, display-over-other-apps, calendar read/write, camera, storage.

### Still open (needs the backend or a product decision)
- Real SMS codes and Android SMS Retriever auto-read; data saved on the server; push notifications (Firebase).
- Delete account in the app and on the web; Report / Block / Copy on posts and comments.
- Pin unacknowledged important notices above the greeting.
- Moderation that separates complaints about services from attacks on people; multilingual / Hinglish assistant.
- Photo step and a form alternative in issue reporting; welcome cards; date-time picker in Suggest an event.
- Release signing key (still signed with the debug certificate), secure token storage, backup rules.
- Privacy Policy and Terms are plain-language drafts, English only; they need legal review and web hosting.

### Success messages and what triggers each
| Message | Shown when |
|---|---|
| Code sent to +91 … | Get OTP is tapped with a valid number (demo: no SMS is sent; the code is 123456) |
| A new code is on its way | Resend on the code screen (demo: no SMS is sent) |
| **ISS-…** created — track it in My Issues | An issue is created from the assistant's preview |
| Published to the community feed | A post passes the abuse check and is published |
| Reply posted | A reply passes the abuse check |
| Held for review — only you can see … | A post or reply trips the warning list and the author posts anyway |
| Gratitude sent — thank you … | A gratitude note passes the abuse check |
| Vote recorded — thank you! One vote per unit. | A poll option is picked |
| RSVP confirmed / You got the last seat! / You're #1 on the waitlist / RSVP removed. | RSVP actions on Events |
| Added to your calendar | iOS reports the event was saved |
| Opened in your calendar | Android calendar form closed (save or discard can't be told apart) |
| Thanks — your acknowledgement is recorded. | Acknowledge on an important notice |
| Update added to the issue / Issue reopened. / Thanks! Your rating is private. | Issue follow-ups |
| Idea saved — it shows as pending … | Suggest an event is sent |
| {name} added — pending verification … / {name} removed from your unit | Family & unit changes |
| App language changed to … | A different language is picked |
| Assistant chat history cleared | Profile → Privacy → Clear, after confirming |
| (system share sheet) / Your data was copied as JSON. | Profile → Privacy → Download my data (phone / web) — since 1.2.0 |
| Added to the moderation queue — thank you. | Report on someone else's post or comment — since 1.2.0 |
| You won't see posts or comments from … / … unblocked | Block (after confirming) / Unblock — since 1.2.0 |
| Deleted | Delete on your own post or comment, after confirming — since 1.2.0 |
| Copied | Copy text from the ⋯ menu — since 1.2.0 |
| Account deleted from this phone. | Delete my account, after confirming — since 1.2.0 |
| Test notification sent … | Profile → Notifications → Send a test |
