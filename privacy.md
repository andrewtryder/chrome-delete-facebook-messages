# Privacy Policy

**Delete Facebook Messages**  
Effective date: September 23, 2026

Delete Facebook Messages is an open-source Chrome extension that helps users preview, delete, archive, and restore Facebook Messenger conversations by automating the Messenger interface in the user's browser.

This privacy policy explains what information the extension can access, how that information is used, and what is stored.

## Summary

- The extension performs its work locally in your browser.
- It does not send Facebook Messenger message content, conversation names, thread URLs, Facebook IDs, cookies, authentication tokens, or other account content to the developer or to an external server.
- It does not sell, rent, or share user data for advertising, analytics, profiling, or marketing.
- It does not include analytics, telemetry, advertising SDKs, or remote executable code.
- It stores only extension preferences and limited aggregate activity information in Chrome extension storage.

## Information the extension can access

To perform the actions you request, the extension runs on supported Facebook Messenger pages and may temporarily read information that is visible in the Messenger interface, including:

- conversation rows and conversation labels;
- Messenger menu items, buttons, dialogs, and confirmation controls;
- the current Messenger page URL and page state;
- whether a conversation appears in the regular, Marketplace, or Archived view.

This information is processed locally and transiently so the extension can identify the correct Messenger controls and perform the action you selected.

The extension does not intentionally collect or persist the contents of your messages.

## Information stored locally

The extension uses Chrome's extension storage to save settings and small aggregate activity records, including items such as:

- theme preference;
- Dry run preference;
- conversation limit settings;
- action delay/speed setting;
- the most recent operation type;
- aggregate counts such as processed, inspected, skipped, and error totals;
- a timestamp and general operation result/status.

This information remains in Chrome extension storage on your device. It is not transmitted to the developer.

## Information not collected or transmitted

The extension does not transmit to the developer or to third parties:

- message text;
- conversation names;
- Facebook or Messenger account identifiers;
- thread URLs;
- cookies;
- authentication tokens;
- browsing history;
- contacts;
- payment information;
- advertising identifiers.

The extension does not operate a backend service for collecting extension usage data.

## Network activity

The production extension does not send extension data to a developer-operated server or analytics service.

Messenger itself may make its normal network requests to Meta/Facebook while you use Messenger. Those requests are part of the Facebook/Messenger service and are not controlled by this extension.

## Chrome permissions

The extension currently requests the following Chrome permissions:

### `tabs`

Used to locate an open Messenger tab, determine whether the current tab is a supported Messenger page, and open or focus Messenger when requested by the user.

The extension does not use this permission to build or transmit a browsing-history profile.

### `storage`

Used to store extension preferences and limited aggregate activity information locally in Chrome extension storage.

### Messenger site access

The production content script is limited to supported Facebook Messenger routes and Messenger.com. Site access is used only so the extension can inspect and interact with Messenger's user interface when carrying out a user-requested preview, delete, archive, or restore operation.

## Destructive actions

Deleting conversations is an explicit user-initiated action.

The extension provides a Dry run mode for previewing selections and displays an additional confirmation step before starting a destructive deletion operation. The extension is designed to fail closed when it cannot confidently identify the expected Messenger menu or confirmation control.

## Data sharing and sale

The developer does not sell user data.

The developer does not share user data with advertisers, data brokers, analytics providers, or other third parties.

Because the extension does not transmit Messenger content or locally stored extension preferences to the developer, the developer does not maintain a server-side copy of that information.

## Data retention and deletion

Preferences and aggregate activity information are kept in Chrome extension storage until they are changed, cleared, reset, or the extension is removed.

The extension provides controls for clearing activity information and resetting settings.

## Security

The extension is built as a Manifest V3 Chrome extension and is open source. The production package does not load remote executable code.

Source code is available at:

https://github.com/andrewtryder/chrome-delete-facebook-messages

## Children's privacy

The extension is not designed to collect personal information from children. It does not knowingly collect or transmit personal information to the developer from any user.

Use of Facebook and Messenger is also subject to Meta's own terms, age requirements, and privacy policies.

## Third-party services

Delete Facebook Messages is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Meta or Facebook.

Your use of Facebook and Messenger remains subject to Meta's own privacy policy and terms of service.

## Changes to this privacy policy

This policy may be updated if the extension's functionality, permissions, or data-handling practices change.

Material changes will be reflected in this file in the public source repository.

## Contact

For privacy questions or concerns, open an issue in the public project repository:

https://github.com/andrewtryder/chrome-delete-facebook-messages/issues

Please do not include message contents, conversation names, account IDs, cookies, authentication tokens, or other private Facebook data in a public issue.
