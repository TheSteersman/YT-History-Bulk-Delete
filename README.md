# YouTube History Bulk Delete

Adds a checkbox to every video on your YouTube watch history page
(youtube.com/feed/history). Check the ones you want gone, click the red
"Delete selected" button that appears in the bottom-right corner, and it
removes them from your history one after another automatically -- it's
driving the same "..." menu -> "Remove from watch history" action YouTube's
own UI uses, just looped across everything you checked.

## Install (Chrome, unpacked)

1. Open `chrome://extensions`.
2. Turn on "Developer mode" (top-right toggle).
3. Click "Load unpacked" and select this `yt-history-bulk-delete` folder.
4. Go to youtube.com/feed/history. Once there, refresh and a small checkbox will appear in the top left corner of each video's thumbnail.
5. Check all that you want to delete and click on "Delete".
6. Stay on the page while it automatically deletes videos and shorts from your Watch History.

## Using it

1. Check the boxes on whatever you want removed. Checked rows get a red
   outline so it's obvious what's queued.
2. Click "Delete N selected" in the bottom-right.
3. It works through the list, showing progress ("Deleting... (4/22)").
   When it's done it either shows "Removed 22 videos" (success) or tells
   you how many failed.

## v1.0.1 update

Fixed a bug where the script marked a row as "handled" the instant it
looked at it, before checking whether YouTube had actually finished
rendering that row's "..." menu -- which meant it gave up permanently on
every row on the very first pass, before the page had a chance to finish
loading. It now retries a row for a few seconds before giving up on it.

It also now logs one diagnostic line on load listing every custom element
tag on the page that looks like a content row (renderer/view-model/lockup/
shelf). If checkboxes still don't show up on some rows -- especially the
Shorts shelf -- that line tells us the actual tag names YouTube is using
there, which is what I need to target them correctly.

To pick up this version: go to `chrome://extensions`, click the reload
icon on "YouTube History Bulk Delete", then refresh the history page.

## v1.0.2 update

Your console output showed the real cause: YouTube has moved the history
page's rows to a newer component (`yt-lockup-view-model`) instead of the
older one this was first built against, and the popup menu's contents
apparently changed along with it -- searching for "Remove from watch
history" by the old tag names came up empty on every row.

Two changes:

- Finding the menu item no longer depends on any specific tag name at
  all. It now searches for the smallest visible element anywhere on the
  page whose own text matches "remove from watch history," which should
  survive YouTube renaming its internal components again in the future.
- When it still can't find that option, it now logs exactly what's
  actually sitting in the open menu/popup at that moment (tag, class,
  visible text) instead of just saying "not found." If this next test
  still fails, that log tells us the real wording/structure directly.

To pick up this version: `chrome://extensions` -> reload the extension,
then refresh the history page.

## v1.0.3 update

Good news from your last test: it was actually working. Clicking "Remove
from watch history" succeeded every time -- YouTube just doesn't remove
the row from the page here, it swaps the row's content in place for a
confirmation bar that says "All views of this video removed from
history." My code was only checking whether the row disappeared or went
invisible, which never happened, so it kept reporting failure on rows
it had, in fact, already removed.

It now also treats that in-place confirmation text as success. On
success it also removes the checkbox from that row, since it's no longer
a video -- that's why checked boxes were sticking around on already-
removed items.

Nothing you deleted in the last test needs to be redone -- those videos
are already gone from your real watch history despite the "failed"
message. This fix just makes the extension's own status match reality.

## v1.0.4 update

Same false-failure pattern showed up on Shorts as on regular videos, but
for a different reason: Shorts don't show any visible "removed" confirmation
in the page at all within a few seconds, they just quietly disappear once
you refresh. You confirmed this twice now (regular videos, then Shorts) --
every time it successfully found the "..." menu and successfully found and
clicked "Remove from watch history," the video was actually gone on
refresh, whether or not anything visibly changed on the page right away.

So it no longer waits for visual proof to call something a success. It
still tries for 2 seconds to confirm it visually (and cleans up the
checkbox right away when it can), but if that doesn't happen, it now logs
a note and counts it as done anyway, rather than reporting a failure that
isn't real. The only things that still count as genuine failures are: no
"..." menu found on a row, or no "Remove from watch history" option found
inside the menu that did open -- those are the two things that have
actually indicated a real problem so far.

## v1.0.5 update

Cosmetic-only fix: Shorts were correctly being removed (confirmed by
refreshing), but their checkbox stayed checked on screen because nothing
about a Short's tile visibly changes the way a regular video's does. The
checkbox is now cleared immediately after a successful click instead of
waiting on a visual confirmation that Shorts never provide.

## Known limitations -- read this before relying on it

- **This is UI automation, not an official API.** It works by clicking
  YouTube's own menu the same way you would, which means it can break any
  time YouTube changes the history page's markup. There's no way around
  that for something that isn't a supported integration.
- **Shorts are the biggest unknown.** I built the row-detection to also
  look at the tile types Shorts sometimes use, but I couldn't verify the
  exact menu structure for a Shorts shelf without a real account's history
  to test against (watch history isn't visible unless you're signed in).
  If checkboxes don't show up on Shorts entries, or clicking delete on one
  fails, that's the likely reason -- tell me what you see and I'll adjust.
- **If a row's checkbox never appears**, it means the script couldn't find
  a "..." menu on that row at all, so it skipped adding a checkbox rather
  than offering one that wouldn't work.
- **If deletion reports failures**, open DevTools (press F12 or
  Cmd+Option+I), click the Console tab, and type `YHBD` into the filter
  box. Copy whatever warnings/errors show up there and send them to me --
  that tells me exactly which step (opening the menu, finding "Remove from
  watch history", or confirming the row disappeared) didn't behave the way
  I expected, so I can fix the actual failure instead of guessing.

## Uninstall

`chrome://extensions` -> find "YouTube History Bulk Delete" -> Remove.
