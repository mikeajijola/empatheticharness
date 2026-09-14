export interface VisualCase {
  scenario: string;
  description: string;
  task: string;
  success: boolean;
  keyboard?: boolean;
  scroll?: boolean;
  recovery?: boolean;
}

export const visualCases: readonly VisualCase[] = [
  { scenario: 'navigation', description: 'Straightforward navigation to workspace settings',
    task: 'Open workspace settings and verify that notifications are enabled.', success: true },
  { scenario: 'form', description: 'Complete and submit a text form',
    task: 'Create a contact named Alex Morgan with email alex@example.com. Verify the contact was created.', success: true, keyboard: true },
  { scenario: 'scroll', description: 'Scroll to an off-screen confirmation control',
    task: 'Accept the service terms using the acknowledgement at the bottom of the page. Verify the acknowledgement was recorded.', success: true, scroll: true },
  { scenario: 'modal', description: 'Open a modal, edit its field, and save',
    task: 'Rename the workspace to Aurora Studio and verify the saved workspace name.', success: true, keyboard: true },
  { scenario: 'validation', description: 'Trigger client-side validation, then correct the input',
    task: 'Try reserving a seat with the access code left blank first. Then correct any validation error using the code shown on screen and verify that a seat is reserved.', success: true, keyboard: true, recovery: true },
  { scenario: 'recovery', description: 'Follow an obsolete shortcut, recognize the wrong destination, and recover',
    task: 'Open Project Atlas using the Open Project Atlas shortcut first. If the shortcut takes you to the wrong place, recover using the visible interface and open the active Project Atlas dashboard.', success: true, recovery: true },
  { scenario: 'ambiguous', description: 'Disambiguate visually similar navigation choices',
    task: 'Open the team workspace monthly report for Northstar Design. Verify you are viewing the team report, rather than the personal report.', success: true },
  { scenario: 'delay', description: 'Observe delayed completion after initiating an export',
    task: 'Generate an export of the current report and verify that northstar-report.csv is ready to download.', success: true },
  { scenario: 'false-success', description: 'Final click occurs but publication fails visibly',
    task: 'Publish the Autumn launch draft and verify that it is published.', success: false },
  { scenario: 'success', description: 'Confirm a genuine visible saved state',
    task: 'Enable the weekly summary and verify that the saved preference is On.', success: true },
];
