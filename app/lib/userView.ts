// Other people's profiles (app/user/[id].tsx) are switched off for now.
//
// Opening one crashed the app: the screen depends on a backend endpoint that
// isn't available yet. Until it is, every place that would open someone else's
// profile shows this message in a FadingNotice instead of navigating. The
// route itself is left in place, so turning profiles back on means flipping
// USER_VIEW_ENABLED and nothing else.
//
// Entry points that check this:
//   - attendee faces on the event screen (app/event/[id]/index.tsx)
//   - person rows in the Followers / Following sheet
//     (app/components/profile/FollowListSheet.tsx)
// Your OWN row still goes to your profile tab; orgs are unaffected.

export const USER_VIEW_ENABLED = false;

export const USER_VIEW_UNAVAILABLE_MESSAGE = 'User view not available right now';
