# Settle — calendar + task board

This is a multi-file vanilla JavaScript app based on the original Settle calendar's look and feel. It adds Supabase email/password authentication, a task board, drag-and-drop scheduling, recurring occurrences, overdue handling, and completion history.

## Project files

- `index.html` — page structure and login/sign-up screen
- `styles.css` — layout and visual styles
- `app.js` — calendar, board, drag-and-drop, recurrence, auth, and database operations
- `config.js` — your Supabase project URL and public browser key
- `supabase-schema.sql` — database tables and row-level security policies

## 1. Create/configure Supabase

1. Create or open a project at https://supabase.com/.
2. Open **SQL Editor**, create a new query, paste all of `supabase-schema.sql`, and run it.
3. In **Project Settings → API** (or the project's API keys page), copy the **Project URL** and the **publishable key** (or legacy `anon` key).
4. The original Supabase URL and public `anon` key from your existing file are already filled into `config.js`. If you want to use a different Supabase project, replace them with that project’s values:

   ```js
   export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
   export const SUPABASE_ANON_KEY = 'YOUR_PUBLISHABLE_OR_ANON_KEY';
   ```

   Never put a `service_role` or secret key in a browser app. The SQL enables Row Level Security, and app queries run as the signed-in user.

5. In Supabase **Authentication → URL Configuration**, add the URL where you will run/host Settle to the allowed Site URL / Redirect URLs. For local testing with a development server, add its local URL. If email confirmation is enabled, a new user may need to confirm their email before signing in.

## 2. Run the app locally

Because `app.js` uses JavaScript modules, don't open `index.html` by double-clicking it as a `file://` URL. Serve the folder over HTTP instead. For example, if Python is installed, open a terminal in this folder and run:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000.

You can also deploy these static files to Netlify, Vercel, or another static host. Add the deployed URL to Supabase Auth's allowed URLs.

## 3. Features and behavior

- **Login/sign-up:** Email and password via Supabase Auth. Passwords are handled by Supabase, not stored in your own tables.
- **Forgot password:** "Forgot password?" on the sign-in screen emails a reset link. The link opens Settle on a "Choose a new password" screen, then signs the user in. The live site's URL must be in Supabase Auth → URL Configuration → Redirect URLs (e.g. `https://your-site.netlify.app/**`). Reset emails use the same email sender as sign-up confirmations, so emails to anyone outside your Supabase team need custom SMTP.
- **Calendar:** Week view, draggable tasks between days and times, half-hour placement, duration resizing, and an Unscheduled drop area.
- **Task board:** To Do, In Progress, and Done. Drag cards between columns or use the status menu.
- **Recurring tasks:** Choose one or more weekdays and an optional end date. Each occurrence has its own status and completion timestamp.
- **Missed occurrences:** Unfinished past occurrences stay on their original date and remain overdue; future occurrences stay scheduled.
- **Completion history:** Completing one occurrence records that occurrence and its completion time. It does not mark future occurrences complete.
- **Data privacy:** Every task/occurrence row is scoped to the authenticated user by RLS policies.

## Notes

- The recurring generator creates occurrences from the series start date through the earlier of its repeat-until date or one year ahead. It also creates missed past occurrences from the start date, so those remain visible as overdue. It caps a single generation pass at 5,000 days as a safety limit.
- This starter app edits and deletes an individual occurrence. It does not yet provide an “edit entire recurring series” workflow, push notifications, or calendar integrations.
- Test with a new account and a few sample tasks before entering important data.
