export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'recovering' | 'stopped';

const VALID_TRANSITIONS: Record<PlayerState, PlayerState[]> = {
    idle:       ['loading', 'stopped'],
    loading:    ['playing', 'idle', 'stopped'],
    playing:    ['paused', 'loading', 'recovering', 'stopped', 'idle'],
    paused:     ['playing', 'stopped', 'idle'],
    recovering: ['playing', 'idle', 'stopped'],
    stopped:    ['idle'],
};

export class PlayerStateMachine {
    private state: PlayerState = 'idle';
    private guildId: string;

    constructor(guildId: string) { 
        this.guildId = guildId; 
    }

    get current(): PlayerState { 
        return this.state; 
    }
    
    is(s: PlayerState): boolean { 
        return this.state === s; 
    }

    transition(next: PlayerState): boolean {
        if (this.state === next) return true; // Already in that state, bypass warnings safely
        if (!VALID_TRANSITIONS[this.state].includes(next)) {
            console.warn(`[FSM] Invalid transition ${this.state} → ${next} for guild ${this.guildId}`);
            return false;
        }
        console.log(`[FSM] Guild ${this.guildId}: ${this.state} → ${next}`);
        this.state = next;
        return true;
    }
}
