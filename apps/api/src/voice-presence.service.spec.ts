import { VoicePresenceService } from './voice-presence.service';

describe('VoicePresenceService', () => {
  it('lists a connected user once even with two sockets', () => {
    const presence = new VoicePresenceService();
    const participant = {
      channelId: 'voice-1',
      spaceId: 'space-1',
      userId: 'user-1',
      displayName: 'Axel',
    };

    presence.join('socket-1', participant);
    presence.join('socket-2', participant);

    expect(presence.participants('voice-1')).toEqual([
      { userId: 'user-1', displayName: 'Axel' },
    ]);
  });

  it('moves a socket between channels and ignores a stale leave', () => {
    const presence = new VoicePresenceService();
    presence.join('socket-1', {
      channelId: 'voice-1',
      spaceId: 'space-1',
      userId: 'user-1',
      displayName: 'Axel',
    });
    presence.join('socket-1', {
      channelId: 'voice-2',
      spaceId: 'space-1',
      userId: 'user-1',
      displayName: 'Axel',
    });

    expect(presence.leave('socket-1', 'voice-1')).toBeUndefined();
    expect(presence.participants('voice-2')).toHaveLength(1);
    expect(presence.leave('socket-1', 'voice-2')).toBeDefined();
    expect(presence.participants('voice-2')).toHaveLength(0);
  });

  it('only exposes explicitly authorized channels in a snapshot', () => {
    const presence = new VoicePresenceService();
    presence.join('socket-1', {
      channelId: 'voice-1',
      spaceId: 'space-1',
      userId: 'user-1',
      displayName: 'Axel',
    });
    presence.join('socket-2', {
      channelId: 'voice-private',
      spaceId: 'space-2',
      userId: 'user-2',
      displayName: 'Outro usuário',
    });

    expect(presence.snapshot(['voice-1'])).toEqual([
      {
        channelId: 'voice-1',
        participants: [{ userId: 'user-1', displayName: 'Axel' }],
      },
    ]);
  });
});
