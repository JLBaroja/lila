const li = window.lichess;

type State = 'off' | 'opening' | 'getting-media' | 'ready' | 'calling' | 'answering' | 'getting-stream' | 'on' | 'stopping';

export function palantir(opts: PalantirOpts) {

  const devices = navigator.mediaDevices;
  if (!devices) return alert('Voice chat requires navigator.mediaDevices');

  let state: State = 'off',
    peer: any | undefined,
    myStream: any | undefined;

  function start() {
    setState('opening');
    peer = new window['Peer'](peerIdOf(opts.uid))
      .on('open', () => {
        setState('getting-media');
        devices.getUserMedia({video: false, audio: true}).then((s: any) => {
          myStream = s;
          setState('ready');
          li.sound.say("Voice chat is ready.", true, true);
          ping();
        }, function(err) {
          log(`Failed to get local stream: ${err}`);
        }).catch(err => log(err));
      })
      .on('call', (call: any) => {
        if (!findOpenConnectionTo(call.peer)) {
          setState('answering', call.peer);
          startCall(call);
          call.answer(myStream);
        }
      })
      .on('stream', s => {
        console.log('stream', s);
      })
      .on('connection', c => {
        log("Connected to: " + c.peer);
      })
      .on('disconnected', () => {
        if (state == 'stopping') destroyPeer();
        else {
          setState('opening', 'reconnect');
          peer.reconnect();
        }
      })
      .on('close', () => log('peer.close'))
      .on('error', err => log(`peer.error: ${err}`));
  }

  function startCall(call: any) {
    call
      .on('stream', () => {
        log('call.stream');
        setState('on', call.peer);
        li.sound.say("Connected", true, true);
      })
      .on('close', () => {
        log('call.close');
        stopCall(call);
      })
      .on('error', e => {
        log(`call.error: ${e}`);
        stopCall(call);
      });
    closeOtherConnectionsTo(call.peer);
  }

  function stopCall(_: any) {
    if (!hasAnOpenConnection()) setState('ready', 'no call remaining');
  }

  function call(uid: string) {
    const peerId = peerIdOf(uid);
    if (peer &&
      myStream &&
      peer.id < peerId && // yes that's how we decide who calls who
      !findOpenConnectionTo(peerId)
    ) {
      setState('calling', peerId);
      startCall(peer.call(peerId, myStream));
    }
  }

  function stop() {
    if (peer && state != 'off') {
      setState('stopping');
      peer.disconnect();
    }
  }

  function log(msg: string) {
    console.log('[palantir]', msg);
  }

  function setState(s: State, msg: string = '') {
    log(`state: ${state} -> ${s} ${msg}`);
    state = s;
    opts.redraw();
  }

  function peerIdOf(uid: string) {
    const host = location.hostname;
    const hash = btoa(li.reverse(btoa(li.reverse(uid + host)))).replace(/=/g,'');
    return `${host.replace('.', '-')}-${uid}-${hash}`;
  }

  function destroyPeer() {
    if (peer) {
      peer.destroy();
      peer = undefined;
    }
    if (myStream) {
      myStream.getTracks().forEach(t => t.stop());
      myStream = undefined;
    }
    setState('off');
  }

  function connectionsTo(peerId) {
    return (peer && peer.connections[peerId]) || [];
  }
  function findOpenConnectionTo(peerId) {
    return connectionsTo(peerId).find(c => c.open);
  }
  function closeOtherConnectionsTo(peerId) {
    const conns = connectionsTo(peerId);
    for (let i = 0; i < conns.length - 1; i++) conns[i].close();
  }
  function closeDisconnectedCalls() {
    if (peer) {
      for (let otherPeer in peer.connections) {
        peer.connections[otherPeer].forEach(c => {
          if (c.peerConnection && c.peerConnection.connectionState == 'disconnected') {
            log(`close disconnected call to ${c.peer}`);
            c.close();
            opts.redraw();
          }
        });
      }
    }
  }
  function allOpenConnections() {
    if (!peer) return [];
    const conns: any[] = [];
    for (let peerId in peer.connections) {
      const c = findOpenConnectionTo(peerId);
      if (c) conns.push(c);
    }
    return conns;
  }
  function hasAnOpenConnection() {
    return allOpenConnections().length > 0;
  }

  function ping() {
    if (state != 'off') li.pubsub.emit('socket.send', 'palantirPing');
  }

  li.pubsub.on('socket.in.palantir', uids => uids.forEach(call));
  li.pubsub.on('palantir.toggle', v => { if (!v) stop() });

  start();
  setInterval(closeDisconnectedCalls, 1400);
  setInterval(ping, 5000);

  setInterval(function() {
    peer && Object.keys(peer.connections).forEach(peerId => {
      console.log(peerId, !!findOpenConnectionTo(peerId));
    });
  }, 3000);

  return {
    render: h =>
    devices ? h('div.mchat__tab.palantir.palantir-' + state, {
      attrs: {
        'data-icon': '',
        title: `Voice chat: ${state}`
      },
      hook: {
        insert(vnode) {
          (vnode.elm as HTMLElement).addEventListener('click', () => peer ? stop() : start());
        }
      }
    }, state == 'on' ?
      allOpenConnections().map(c =>
        h('audio.palantir__audio.' + c.peer, {
          attrs: { autoplay: true },
          hook: { insert(vnode) { (vnode.elm as HTMLAudioElement).srcObject = c.remoteStream } }
        })
      ) : []
    ) : null
  }
}