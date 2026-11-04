# Gmail OTP

Customer recovery is still identified by the saved phone number. The backend reads `KHACH_HANG.EMAIL`: a valid saved email receives a real email; an empty/invalid email uses the saved phone number with OTP printed in backend logs. Admin uses the saved employee email. OTP expires after 60 seconds, allows five wrong attempts, and resending invalidates the previous code.

Email failures return an error and invalidate that code; they never silently fall back to terminal for an email account. Email OTP is not printed in logs. Existing database names and fields are unchanged.

## Configure the shop Gmail

Render Free blocks SMTP ports, so this integration uses Gmail API over HTTPS. A Gmail App Password is not used by this transport.

1. Sign in to Google Cloud using the shop Gmail, create/select a project, and enable Gmail API.
2. Configure the OAuth consent screen. If the app is in Testing, add the shop Gmail as a test user.
3. Create an OAuth client of type Web application. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
4. Open OAuth 2.0 Playground. In its settings enable **Use your own OAuth credentials**, entering the client ID and secret yourself.
5. Authorize only `https://www.googleapis.com/auth/gmail.send` with the shop Gmail. Exchange the authorization code for tokens and obtain the refresh token.
6. In Render > backend > Environment set:
   - `GMAIL_SENDER`: shop Gmail address
   - `GMAIL_CLIENT_ID`: OAuth client ID
   - `GMAIL_CLIENT_SECRET`: OAuth client secret
   - `GMAIL_REFRESH_TOKEN`: refresh token issued for the shop Gmail
7. Save and redeploy the backend. For local testing, put the same values in the ignored `.env` file.

Never paste tokens/passwords into chat or commit them. OAuth apps left in External/Testing can receive refresh tokens that expire after seven days for Gmail scopes; complete the appropriate publishing/consent setup before relying on it long term. Follow Google's current consent-screen requirements.

## Before enabling on production

Configure the four values first. Verify a real email reaches a consenting test mailbox, verify an account with no email still prints its OTP, then verify that resending invalidates the previous code. Provider credentials and real delivery must be checked on Render; mocked transport tests do not prove real delivery.

References: https://render.com/docs/free ; https://developers.google.com/workspace/gmail/api/guides/sending ; https://developers.google.com/identity/protocols/oauth2/web-server
