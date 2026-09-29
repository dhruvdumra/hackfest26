# HR approval screen in SAP Build Apps

Optional, lowest value, about an hour. It needs the backend on BTP first
(`docs/BTP_DEPLOY.md`), because Build Apps can only call a public HTTPS URL.

You build one page. It shows the rewritten job post and the number of
candidates it had hidden, with **Approve** and **Reject** buttons. It calls the
same API as the React HR console, so a decision made in either one shows in the
other: the React console reads the latest decision back when it loads a post.

## 1. Get SAP Build Apps

1. In the BTP trial cockpit, open **Boosters** and search for **SAP Build Apps**
   (e.g. "Set up account for SAP Build Apps"). Choose **Start** and wait until it finishes.
2. Go to **Services → Instances and Subscriptions**, find **SAP Build**, and choose **Go to Application**.
   This opens the SAP Build lobby.

## 2. Create the app

**Create → Build an Application → Web & Mobile Application**. Name it
`ReRoute HR approval`.

## 3. Page variables

Open the page's **Variables** tab (Page Variables) and add:

- `rewrite`, an Object
- `decision`, a Text

## 4. Load the rewrite when the page opens

1. Install the **HTTP request** flow function from the Marketplace (Logic panel → Marketplace).
2. Select the page (not a component), open **Add logic**, and use the **Page mounted** event:
   - **HTTP request**
     - URL `https://<backend-route>/employer/rewrite-filter`
     - Method `POST`
     - Headers `Content-Type: application/json`
     - Body (formula) `ENCODE_JSON({"job_post_id": "post-chennai-qa-analyst-118"})`
   - **Set page variable** `rewrite` to the response body. If the body arrives as
     text, wrap it: `PARSE_JSON(outputs["HTTP request"].response.body)`.

## 5. The page

Add these components, top to bottom:

1. **Title**: `Rewrite the filter, not the shortlist`.
2. **Text** labelled "Before", bound to `pageVars.rewrite.filter_text_before`.
3. **Text** labelled "After", bound to `pageVars.rewrite.filter_text_after`.
4. **Text**, formula `"Hidden by this filter: " + pageVars.rewrite.hidden_talent_count`.
5. **Button "Approve and publish"**, with this tap logic:
   - **HTTP request**
     - URL `https://<backend-route>/employer/rewrite-filter/post-chennai-qa-analyst-118/decision`
     - Method `POST`
     - Header `Content-Type: application/json`
     - Body `ENCODE_JSON({"approved": true})`
   - **Set page variable** `decision` to the response's `message`.
   - **Toast** showing `pageVars.decision`.
6. **Button "Reject"**: the same logic with `{"approved": false}`.
7. **Text** bound to `pageVars.decision`.

## 6. Allow the preview's origin (CORS)

1. Choose **Launch → Open web preview** and open the app.
2. Press F12. If the console shows a CORS error, it names the page's origin.
3. Add that origin to the backend's `CORS_ORIGINS` (`docs/BTP_DEPLOY.md`, step 6)
   and restage.

## 7. Demo it

1. Open the Build Apps preview and choose **Approve and publish**.
   The toast reads *"Published by hiring manager"*.
2. In the ReRoute page, go to the HR console and choose **Rewrite this post**.
   The sign-off block shows the same decision.

Honest wording: *"HR approval screen built in SAP Build Apps on top of our
API."*
