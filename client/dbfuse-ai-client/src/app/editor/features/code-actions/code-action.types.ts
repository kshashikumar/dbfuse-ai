export interface InlinePopoverPayload {
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
}
