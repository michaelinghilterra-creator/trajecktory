# Connect Gmail to trajecktory

**Read this first: you have to create your own Google connection, and it takes about
15 minutes in Google's console. trajecktory does not ship one, and cannot do this step
for you.**

That is a deliberate choice, not a missing feature. Reading someone's mail is what
Google calls a *restricted scope*. To publish one shared connection that everyone
could use, the maintainer would have to pass a Google security review and then hold a
key that reaches every user's inbox. Three things fall out of doing it your way
instead:

- Nobody else can read your mail, because nobody else has your key.
- Your quota is your own, so another user's heavy week cannot slow you down.
- If one person's key is ever revoked, every other install keeps working.

The cost is this page. Do it once and it stays done.

---

## What you get

| | |
|---|---|
| **What it does** | trajecktory reads your mail for replies to the jobs you applied to, and for bounced outreach. It can also write a draft into your Gmail for you to review and send yourself. |
| **So what** | Replies stop slipping past you, your reply rate stops being wrong (a bounced email is not a company ignoring you), and a follow-up you asked for is waiting in Gmail instead of on your to-do list. |
| **If you skip it** | Everything else works exactly the same. You log replies by hand on the Review tab, and the reply-rate number counts a bounced address as a non-response, which makes your outreach look worse than it is. |

**trajecktory can never send mail from your account.** There is no send path in the
code, only "create a draft". You press send, in Gmail, every time.

---

## Before you start

- A Google account. A free personal one is fine.
- The dashboard installed and running.
- About 15 minutes. Most of it is clicking through Google's console.

---

## Step 1: create a project (about 2 minutes)

Go to [console.cloud.google.com](https://console.cloud.google.com/), and create a new
project. Any name works. Nothing else in your Google account changes.

**Why:** a connection has to live inside a project. This is just the container.

## Step 2: turn on the Gmail API

In the project, go to **APIs & Services**, then **Library**, search for **Gmail API**,
and click **Enable**.

**Why, and the mistake to avoid:** if you skip this, everything below still appears to
work. You will connect successfully, see a green "connected" line, and then every mail
check will fail. Turn it on now and that whole class of confusion never happens.

## Step 3: fill in the consent screen

**APIs & Services**, then **OAuth consent screen**.

- User type: **External**. (Internal only exists for Google Workspace organizations.)
- App name: anything you will recognize, for example "trajecktory".
- User support email and developer contact email: your own address.
- **Test users: add your own Gmail address.**

**Why the test-user step matters:** until you publish the app, Google only lets people
on that list connect. If your own address is missing you will get "access blocked" at
the moment you try to connect, and the message does not explain why.

## Step 4: add the two permissions

On the same consent screen, add scopes:

| Scope | What it buys you |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | Finding replies and bounces. |
| `https://www.googleapis.com/auth/gmail.compose` | The "Draft in Gmail" buttons. |

Add both. If you add only the first, trajecktory works but every Draft button answers
"this connection is read-only, reconnect", and you have to come back here anyway.

Google will warn you that these are sensitive or restricted scopes. That warning is
about apps that publish to the public. You are the only user of this one.

## Step 5: create the credentials

**APIs & Services**, then **Credentials**, then **Create credentials**, then
**OAuth client ID**.

**Application type: Desktop app.** This is the one setting on this page that is easy to
get wrong and annoying to undo.

**Why Desktop app and not Web application:** a desktop client is allowed to hand the
answer back to any address on your own machine, so there is no return address to
register and it keeps working no matter which port the dashboard happens to start on.
Pick "Web application" and you have to pre-register an exact address, and the day the
port changes, connecting breaks.

Google shows you a **client ID** and a **client secret**. Keep the tab open.

## Step 6: paste them into trajecktory

Open `dashboard-web/.env` in a text editor (create it by copying `.env.example` if it
is not there yet) and add these two lines:

```
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

Two things to know:

- **`.env` is never committed.** It is in `.gitignore`, and it holds live secrets. Do
  not paste these values into a chat, an issue, or a screenshot.
- **Restart the dashboard.** trajecktory reads this file once, at startup. If you edit
  it while the dashboard is running, nothing happens, and the Connect button will still
  tell you the client ID is missing. Close it and start it again.

## Step 7: connect

In the dashboard, go to **Insights**, then **Review**, and click **Connect Gmail** on
the Gmail sync card. Google will ask you to sign in and approve.

**You will see a screen saying Google has not verified this app.** That is expected and
it is not a problem: it is your app, in your project, used by you. Click **Advanced**,
then **Go to (your app name)**.

Approve both permissions. The browser comes back to the dashboard and the card should
read "connected as you@example.com, read-only".

---

## What is normal after this

- **The unverified-app warning, every time you reconnect.** Every self-made connection
  shows it. It does not go away without a Google review, and it does not need to.
- **A reconnect roughly once a week.** While the app's publishing status is **Testing**,
  Google deliberately expires the connection after seven days. The Review tab shows a
  nudge and reconnecting is one click. Nothing is lost in between, the sweep just did
  not run.
- **To stop the weekly reconnect:** on the OAuth consent screen, set publishing status
  to **In production**. The seven-day expiry goes away. The unverified warning stays,
  and unverified apps are capped at 100 users, which does not matter when the user is
  you. Google may ask for verification later if it ever notices Gmail scopes in use.
  Either mode works. Testing is the safer place to start.
- **The first check takes a few seconds.** It reads a few hundred message headers.

---

## When something goes wrong

| What you see | What it actually means | Fix |
|---|---|---|
| A blank page saying "Missing GOOGLE_CLIENT_ID in dashboard-web/.env" | The dashboard has not read your `.env` yet | Restart the dashboard |
| "Access blocked" while approving | Your address is not on the test-user list | Step 3, add yourself, try again |
| Connected, but every mail check errors | The Gmail API was never enabled | Step 2 |
| "This Gmail connection is read-only. Reconnect to grant draft access." | You connected before adding `gmail.compose` | Step 4, then reconnect |
| "Connection expired, reconnect to resume" | The weekly Testing-mode expiry | Reconnect, or publish the app (above) |
| Connect does nothing, or returns an error about state | The consent request timed out (10 minutes) | Click Connect again |

## Turning it off

Two independent switches, and either one is enough:

- **In trajecktory:** delete `data/google-tokens.json`. The connection is gone at once.
- **In Google:** go to your Google account, Security, "Your connections to third-party
  apps", and remove the app. This also invalidates anything already issued.

Deleting the whole Google Cloud project removes the client itself, so no future
connection can be made with it.
