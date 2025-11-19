# Extension-এর Basic Requirements

- Google Chrome (latest) ইনস্টল এবং Developer mode অন থাকতে হবে।
- প্রজেক্ট ফোল্ডারে [manifest.json](manifest.json), [background.js](background.js), [content.js](content.js), [popup.html](popup.html) থাকতে হবে।

# Tool কী করে

- ওয়েব পেজের ডেটা সংগ্রহ/প্রসেস করে স্বয়ংক্রিয় কাজ চালায়।
- প্রয়োজন হলে ডেটা ফাইল (যেমন XLSX) পড়া/লেখা সাপোর্ট করে।

# Tool দিয়ে কী করতে হবে

- টার্গেট ওয়েব পেজ খুলে কাঙ্ক্ষিত অ্যাকশন চালু করুন।
- পপআপ থেকে বাটন/অপশন ব্যবহার করে প্রসেস শুরু/থামান।

# কিভাবে Run করতে হবে

1. Chrome খুলুন → chrome://extensions এ যান → Developer mode অন করুন।
2. “Load unpacked” ক্লিক করুন → আপনার প্রজেক্ট ফোল্ডার সিলেক্ট করুন (যেখানে [manifest.json](manifest.json) আছে)
3. এক্সটেনশন পিন করুন → আইকনে ক্লিক করে
4. যেই পেজে কাজ করবেন তা Open/রিলোড করুন
5. প্রয়োজনে লগ দেখুন: DevTools Console বা Extensions → Service Worker লগ ([background.js](background.js))
