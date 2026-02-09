import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ComponentRef,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    Output,
    SimpleChanges,
    Type,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

type ResultGridType = Type<{
    triggerQuery: any;
    executeTriggered: boolean;
    externalResult: any;
    dbName: string;
    tabId: string;
    resultsChanged: EventEmitter<any[]>;
    getActiveResultIndex?: () => number;
    setActiveResultIndex?: (index: number) => void;
    closeResultTab?: (index: number) => void;
    clearTabCache?: (tabId: string) => void;
    clearAllCache?: () => void;
}>;

@Component({
    selector: 'app-resultgrid-host',
    standalone: true,
    imports: [CommonModule],
    template: '<ng-template #host></ng-template>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultGridHostComponent implements AfterViewInit, OnChanges, OnDestroy {
    @Input() triggerQuery: any = '';
    @Input() executeTriggered: boolean = false;
    @Input() externalResult: any = null;
    @Input() dbName: string = '';
    @Input() tabId: string = '';
    @Output() resultsChanged = new EventEmitter<any[]>();

    @ViewChild('host', { read: ViewContainerRef }) host?: ViewContainerRef;

    private componentRef?: ComponentRef<any>;
    private resultsSub?: Subscription;
    private pendingInputs: Record<string, any> = {};
    private loading = false;

    ngAfterViewInit(): void {
        void this.ensureLoaded();
    }

    ngOnChanges(_changes: SimpleChanges): void {
        this.syncInputs();
    }

    ngOnDestroy(): void {
        this.resultsSub?.unsubscribe();
        this.componentRef?.destroy();
    }

    getActiveResultIndex(): number {
        return this.componentRef?.instance?.getActiveResultIndex?.() ?? 0;
    }

    setActiveResultIndex(index: number): void {
        this.componentRef?.instance?.setActiveResultIndex?.(index);
    }

    closeResultTab(index: number): void {
        this.componentRef?.instance?.closeResultTab?.(index);
    }

    clearTabCache(tabId: string): void {
        this.componentRef?.instance?.clearTabCache?.(tabId);
    }

    clearAllCache(): void {
        this.componentRef?.instance?.clearAllCache?.();
    }

    private async ensureLoaded(): Promise<void> {
        if (this.componentRef || this.loading) {
            return;
        }
        this.loading = true;
        const container = this.host;
        if (!container) {
            this.loading = false;
            return;
        }
        const module = await import('./resultgrid.component');
        const component = module.ResultGridComponent as ResultGridType;
        container.clear();
        this.componentRef = container.createComponent(component);
        this.resultsSub = this.componentRef.instance.resultsChanged.subscribe((results: any[]) => {
            this.resultsChanged.emit(results);
        });
        this.loading = false;
        this.syncInputs();
    }

    private syncInputs(): void {
        const inputs = {
            triggerQuery: this.triggerQuery,
            executeTriggered: this.executeTriggered,
            externalResult: this.externalResult,
            dbName: this.dbName,
            tabId: this.tabId,
        };

        if (!this.componentRef) {
            this.pendingInputs = inputs;
            void this.ensureLoaded();
            return;
        }

        const merged = { ...this.pendingInputs, ...inputs };
        this.pendingInputs = {};
        Object.entries(merged).forEach(([key, value]) => {
            this.componentRef?.setInput(key, value);
        });
    }
}
