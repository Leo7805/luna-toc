/**
 * Defines the React entry component for the ChatGPT page sidebar.
 */
import {
  SidebarShell,
  type SidebarShellProps,
} from './SidebarShell';

export type SidebarAppProps = SidebarShellProps;

/**
 * Composes the static sidebar shell while legacy modules own its content slots.
 *
 * @example
 * <SidebarApp title="Conversation" emptyHint="Waiting for prompts..." />
 */
export function SidebarApp(props: SidebarAppProps) {
  return <SidebarShell {...props} />;
}
