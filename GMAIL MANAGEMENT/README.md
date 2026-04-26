# Gmail Management & Auto-Responder

একটি ছোট Flask web app যা OAuth 2.0 এর মাধ্যমে আপনার Google account এর সাথে connect হয় এবং আপনাকে নিম্নলিখিত কাজগুলি করতে দেয়:

1. **আপনার inbox Sync করুন** — unique sender এর name/email/subject/date extract করে একটি sortable, filterable table এ দেখায় এবং CSV তে export করা যায়।
2. **একটি campaign CSV upload করুন** (`Email, Subject, Message_Body`) এবং এটি preview করুন।
3. **Campaign Execute করুন** — প্রতিটি row এর জন্য:
   - যদি ঐ address এর সাথে পূর্বের কোনো thread থাকে → সেই thread এ একটি **reply** পাঠান (`In-Reply-To` / `References` preserve করে)।
   - যদি পূর্বের কোনো thread না থাকে → একটি **brand new email** হিসেবে পাঠান।
4. Server-Sent Events দ্বারা চালিত একটি **live progress bar + activity log** দেখুন, send এর মাঝে configurable delay এবং Gmail rate limits এ automatic retry সহ।

## Project layout

```
HR Management/
├── app.py                       # Flask entry point + in-memory job store
├── config.py                    # Env-driven configuration
├── requirements.txt
├── .env.example
├── mail-management-credentials.json   # Google OAuth client secrets (already present)
├── sample_campaign.csv          # Example CSV to test with
├── routes/
│   ├── auth.py                  # OAuth login/callback/logout
│   ├── inbox.py                 # /api/inbox/contacts, /contacts.csv
│   └── campaign.py              # Upload, start, SSE progress
├── services/
│   ├── gmail_service.py         # Gmail API wrapper + reply/new send logic
│   └── csv_service.py           # CSV parsing + export helpers
├── templates/
│   ├── base.html
│   ├── login.html
│   └── dashboard.html           # Tabs: Inbox & Contacts / CSV Campaign
└── static/
    ├── css/custom.css
    └── js/
        ├── dashboard.js         # Tabs + fetch helper
        ├── inbox.js             # Inbox table: sort, filter, export
        └── campaign.js          # Upload, preview, SSE progress
```

## Setup

### ১. Dependencies Install করুন

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### ২. Google OAuth Configure করুন

App টি OAuth client secret JSON আশা করে `mail-management-credentials.json` এ
(ইতিমধ্যে এই directory তে present)। Google Cloud Console এ নিশ্চিত করুন:

- **Gmail API** enabled আছে।
- আপনার OAuth consent screen এ `https://mail.google.com/` scope আছে।
- আপনার OAuth client এর type **Web application** এবং
  `http://127.0.0.1:5000/auth/callback` একটি authorized redirect URI হিসেবে listed আছে।

### ৩. Environment Configure করুন

```bash
cp .env.example .env
# FLASK_SECRET_KEY কে একটি long এবং random value দিয়ে edit করুন
```

`OAUTHLIB_INSECURE_TRANSPORT=1` প্রয়োজন যখন localhost এ plain `http://` দিয়ে
testing করা হয়; production এ HTTPS এর পিছনে এটি unset করুন।

### ৪. Run করুন

```bash
python app.py
```

http://127.0.0.1:5000 open করুন, Google দিয়ে sign in করুন, এবং আপনি dashboard এ পৌঁছে যাবেন।

## App ব্যবহার করা

### Inbox & Contacts

- **Sync inbox**: N সংখ্যক সর্বশেষ INBOX messages pull করে (৫০–৫০০) এবং email address দিয়ে senders deduplicate করে, প্রতি sender এর latest subject/date রাখে।
- **Filter**: search box name, email, অথবা subject দিয়ে filter করে।
- **Sort**: যেকোনো column header এ click করুন।
- **Export CSV**: currently selected "scan" size এর contacts download করে।

### CSV Campaign

- `Email, Subject, Message_Body` headers সহ একটি **CSV Upload করুন**। `sample_campaign.csv` দেখুন।
- Preview table এ rows review করুন।
- **Send / Execute** এ click করুন — আপনি একটি progress bar (যেমন `12 / 50`) এবং প্রতিটি row এর outcome দেখানো একটি live activity log পাবেন:
  - `REPLIED` — existing thread পাওয়া গেছে এবং reply করা হয়েছে।
  - `NEW` — পূর্বের কোনো conversation ছিল না, new email হিসেবে পাঠানো হয়েছে।
  - `FAILED` — কিছু একটা ভুল হয়েছে (কারণ log এ আছে)।
- Send এর মাঝে ২-second delay `SEND_DELAY_SECONDS` এর মাধ্যমে configurable।

## Safety & reliability notes

- **Rate limit handling**: Gmail API calls `429` এবং `5xx` এ exponential backoff দিয়ে wrap করা ([`GmailService._retry`](services/gmail_service.py#L45) দেখুন)।
- **Throttle**: `SEND_DELAY_SECONDS` (default 2s) outbound messages এর মাঝে sleep করে spammy না দেখাতে।
- **Threaded replies**: new replies এ `In-Reply-To` এবং `References` headers থাকে যা thread এর last received `Message-ID` এ point করে, এবং সঠিক `threadId` সহ send করা হয় যাতে Gmail conversation অটুট রাখে।
- **Session**: OAuth credentials Flask-Session (`flask_session/` directory) এর মাধ্যমে server-side এ store করা হয়, কখনো cookies এ নয়।
- **Background worker**: campaign একটি daemon thread এ run হয় যাতে HTTP request সাথে সাথে return করে; browser `/api/campaign/progress/<job_id>` (SSE) এর মাধ্যমে live updates পায়।

## Troubleshooting

- `redirect_uri_mismatch`: আপনার OAuth client এ `http://127.0.0.1:5000/auth/callback` listed নেই। Google Cloud Console → Credentials এ এটি add করুন।
- `access_denied` / consent loop: app যখন consent screen এ "Testing" mode এ আছে তখন আপনার account একটি allowed test user হতে হবে।
- `insufficientPermissions`: নিশ্চিত করুন Gmail API enabled এবং token আসলে `https://mail.google.com/` scope পেয়েছে (scopes পরিবর্তন করলে revoke + re-consent করুন)।

## Gmail API Permission Fix (Step-by-Step)

যদি আপনি `insufficientPermissions` বা Gmail access সংক্রান্ত error পান, নিচের steps follow করুন:

### Step 1: Gmail API Enable করুন

`https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=hr-dashboard-484008`

- এই লিংকে গিয়ে **Enable**-এ ক্লিক করুন এবং ১০ সেকেন্ড পর পেজটি রিফ্রেশ করুন।

### Step 2: Scope Add করুন

- পেজের নিচে **Manually add scopes** সেকশনে গিয়ে `https://mail.google.com/` পেস্ট করুন।
- **Add to table**-এ ক্লিক করে একদম নিচে **Update / Save** করুন।

### Step 3: Session ক্লিয়ার ও Login

- পুরনো ডেটা মুছতে `flask_session/` ক্লিয়ার করুন এবং Flask রিস্টার্ট দিন।
- আবার লগ-ইন করুন এবং consent screen-এ Gmail permission চেকবক্সটিতে টিক দিন।

### Step 4: Test User যুক্ত করুন

- বাম দিকের সাইডবার থেকে **Audience**-এ যান।
- **Test users** সেকশনে **+ Add users**-এ ক্লিক করে `{email}` লিখে **Save** করুন।
- নিশ্চিত করুন পেজের উপরে **Publishing status** যেন **Testing** থাকে।

**Direct Audience Link:**
`https://console.cloud.google.com/auth/audience?project=hr-dashboard-484008`

## Production এ Running

এই app টি personal / internal use এর জন্য ঠিক আছে। একটি hardened deployment এর জন্য আপনি চাইবেন:

- HTTPS এর পিছনে serve করুন, `OAUTHLIB_INSECURE_TRANSPORT` unset করুন।
- In-memory `CAMPAIGN_JOBS` dict কে Redis দিয়ে replace করুন যাতে jobs restarts টিকে থাকে এবং workers জুড়ে scale করে।
- `threading.Thread` এর পরিবর্তে campaign execution একটি real queue (RQ, Celery) এর পিছনে রাখুন।
- POST routes এ CSRF protection add করুন (যেমন, Flask-WTF) এবং CORS tighten করুন।
