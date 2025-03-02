export class CheckpointVisualizer {
    private static readonly GREEN_STATUS = 'checkpoint-green';
    private static readonly RED_STATUS = 'checkpoint-red';
    private isProcessing = false;
    private refreshTimeout: NodeJS.Timeout | null = null;
    private readonly REFRESH_DELAY = 30000; // 30 seconds
    private lastEmptyCheck = 0;
    private readonly EMPTY_CHECK_INTERVAL = 5000; // 5 seconds

    public updateCheckpointStatus(checkpoints: any[]): void {
        if (this.isProcessing) {
            return;
        }

        if (!checkpoints || checkpoints.length === 0) {
            // Schedule next refresh only if not already scheduled
            if (!this.refreshTimeout) {
                this.refreshTimeout = setTimeout(() => {
                    this.refreshTimeout = null;
                }, this.REFRESH_DELAY);
            }
            return;
        try {
            this.isProcessing = true;
            const firstCheckpoint = checkpoints[0];
            firstCheckpoint.status = CheckpointVisualizer.GREEN_STATUS;

            for (let i = 1; i < checkpoints.length; i++) {
                checkpoints[i].status = CheckpointVisualizer.RED_STATUS;
            }
        } finally {
            this.isProcessing = false;
        }
        }
    }
}
