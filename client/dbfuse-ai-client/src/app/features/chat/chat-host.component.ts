import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ComponentRef,
    EventEmitter,
    OnDestroy,
    Output,
    Type,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

type ChatType = Type<{
    sendToEditor: EventEmitter<{ sql: string; dbName: string }>;
}>;

@Component({
    selector: 'app-chat-host',
    standalone: true,
    imports: [CommonModule],
    template: '<ng-template #host></ng-template>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatHostComponent implements AfterViewInit, OnDestroy {
    @Output() sendToEditor = new EventEmitter<{ sql: string; dbName: string }>();

    @ViewChild('host', { read: ViewContainerRef }) host?: ViewContainerRef;

    private componentRef?: ComponentRef<any>;
    private sendSub?: Subscription;
    private loading = false;

    ngAfterViewInit(): void {
        void this.ensureLoaded();
    }

    ngOnDestroy(): void {
        this.sendSub?.unsubscribe();
        this.componentRef?.destroy();
    }

    private async ensureLoaded(): Promise<void> {
        if (this.componentRef || this.loading) {
            return;
        }
        const container = this.host;
        if (!container) {
            return;
        }
        this.loading = true;
        const module = await import('./chat.component');
        const component = module.ChatComponent as ChatType;
        container.clear();
        this.componentRef = container.createComponent(component);
        this.sendSub = this.componentRef.instance.sendToEditor.subscribe((payload: any) => {
            this.sendToEditor.emit(payload);
        });
        this.loading = false;
    }
}
