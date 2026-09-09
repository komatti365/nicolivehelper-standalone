/**
 * remoteHostBridge.js
 * ホスト側で動作している際に、リモート操作コマンドを実行し、
 * ホストの状態（放送情報、動画再生、ストック、リクエスト、コメント）を収集・配信するブリッジ。
 */

window.RemoteHostBridge = {
  initialized: false,
  _progressTimer: null,

  init() {
    if (this.initialized || typeof window.stsen === 'undefined') return;
    this.initialized = true;

    console.log('[RemoteHostBridge] Initializing remote host bridge...');

    // メインプロセスからのリモートアクション実行リクエストを受信
    if (window.stsen.onRemoteHostExecuteAction) {
      window.stsen.onRemoteHostExecuteAction(async ({ actionId, action, params }) => {
        try {
          console.log(`[RemoteHostBridge] Executing action: ${action}`, params);
          const result = await this.executeAction(action, params);
          if (window.stsen.sendRemoteActionResult) {
            window.stsen.sendRemoteActionResult(actionId, result, null);
          }
          // アクション実行後に最新状態をプッシュ
          this.notifyStateUpdate();
        } catch (err) {
          console.error(`[RemoteHostBridge] Action ${action} failed:`, err);
          if (window.stsen.sendRemoteActionResult) {
            window.stsen.sendRemoteActionResult(actionId, null, err.message || String(err));
          }
        }
      });
    }

    // 再生進捗の定期更新タイマー (1秒毎)
    setInterval(() => {
      this.checkAndBroadcastPlayback();
    }, 1000);

    // 初期状態をメインプロセスへ送信
    setTimeout(() => {
      this.notifyStateUpdate();
    }, 2000);
  },

  // 現在の全状態を収集
  getState() {
    let liveInfo = null;
    if (typeof NicoLiveHelper !== 'undefined' && NicoLiveHelper.liveProp && NicoLiveHelper.liveProp.program) {
      liveInfo = {
        title: NicoLiveHelper.liveProp.program.title || '',
        lvid: NicoLiveHelper.liveProp.program.nicoliveProgramId || '',
        status: NicoLiveHelper.liveProp.program.status || '',
        communityId: (NicoLiveHelper.liveProp.community && NicoLiveHelper.liveProp.community.id) || '',
        casterName: (NicoLiveHelper.liveProp.broadcaster && NicoLiveHelper.liveProp.broadcaster.name) || '',
        beginTime: NicoLiveHelper.live_begintime || 0,
        endTime: NicoLiveHelper.live_endtime || 0,
        isConnected: NicoLiveHelper.isConnected()
      };
    }

    let curVideo = null;
    if (typeof NicoLiveHelper !== 'undefined' && NicoLiveHelper.currentVideo) {
      const v = NicoLiveHelper.currentVideo;
      const progressText = $('#remaining-time-main').text() || '';
      const progressWidth = $('#progressbar-main').css('width') || '0%';
      curVideo = {
        videoId: v.video_id || '',
        title: v.title || '',
        thumbnailUrl: v.thumbnail_url || '',
        lengthMs: v.length_ms || 0,
        progressText: progressText,
        progressWidth: progressWidth,
        beginTime: v.begin_time || 0
      };
    }

    let stocks = [];
    if (typeof NicoLiveStock !== 'undefined' && Array.isArray(NicoLiveStock.stock)) {
      stocks = NicoLiveStock.stock.map((s, idx) => ({
        index: idx,
        videoId: s.video_id || '',
        title: s.title || '',
        thumbnailUrl: s.thumbnail_url || '',
        lengthMs: s.length_ms || 0,
        isPlayed: !!s.is_played,
        noLivePlay: !!s.no_live_play
      }));
    }

    let requests = [];
    if (typeof NicoLiveRequest !== 'undefined' && Array.isArray(NicoLiveRequest.request)) {
      requests = NicoLiveRequest.request.map((r, idx) => ({
        index: idx,
        videoId: r.video_id || '',
        title: r.title || '',
        thumbnailUrl: r.thumbnail_url || '',
        lengthMs: r.length_ms || 0,
        userId: r.user_id || '',
        userName: r.user_name || '',
        commentNo: r.comment_no || ''
      }));
    }

    let recentComments = [];
    if (typeof NicoLiveComment !== 'undefined' && Array.isArray(NicoLiveComment.commentlog)) {
      recentComments = NicoLiveComment.commentlog.slice(-50).map(c => ({
        no: c.no,
        userId: c.user_id,
        userName: NicoLiveComment.getKotehan(c.user_id) || '',
        text: c.text,
        date: c.date,
        premium: c.premium
      }));
    }

    let playStyle = 0;
    let allowRequest = 0;
    if (typeof NicoLiveHelper !== 'undefined') {
      try { playStyle = NicoLiveHelper.getPlayStyle(); } catch (e) {}
      try { allowRequest = NicoLiveHelper.getRequestAllowedStatus(); } catch (e) {}
    }

    return {
      liveInfo,
      currentVideo: curVideo,
      stocks,
      requests,
      settings: {
        playStyle,
        allowRequest
      },
      recentComments,
      timestamp: Date.now()
    };
  },

  // 状態更新をメインプロセスへ通知
  notifyStateUpdate() {
    if (typeof window.stsen !== 'undefined' && window.stsen.sendRemoteHostStateUpdate) {
      const state = this.getState();
      window.stsen.sendRemoteHostStateUpdate(state);
    }
  },

  // 再生プログレスの更新をブロードキャスト
  checkAndBroadcastPlayback() {
    if (typeof NicoLiveHelper === 'undefined' || !NicoLiveHelper.currentVideo) return;
    const v = NicoLiveHelper.currentVideo;
    const progressText = $('#remaining-time-main').text() || '';
    const progressWidth = $('#progressbar-main').css('width') || '0%';

    if (typeof window.stsen !== 'undefined' && window.stsen.sendRemoteHostBroadcastEvent) {
      window.stsen.sendRemoteHostBroadcastEvent('playback-progress', {
        videoId: v.video_id,
        title: v.title,
        progressText,
        progressWidth
      });
    }
  },

  // コメント受信時の通知フック
  onCommentReceived(commentItem) {
    if (typeof window.stsen !== 'undefined' && window.stsen.sendRemoteHostBroadcastEvent) {
      window.stsen.sendRemoteHostBroadcastEvent('comment', {
        no: commentItem.no,
        userId: commentItem.user_id,
        userName: (typeof NicoLiveComment !== 'undefined') ? NicoLiveComment.getKotehan(commentItem.user_id) : '',
        text: commentItem.text,
        date: commentItem.date,
        premium: commentItem.premium
      });
    }
  },

  // リモートコマンドの実行
  async executeAction(action, params = {}) {
    switch (action) {
      // --- 枠接続 ---
      case 'load-live': {
        const lvid = String(params.lvid || '').trim();
        if (!lvid) throw new Error('lvid is required');
        if (typeof window.stsen !== 'undefined' && window.stsen.loadLive) {
          await window.stsen.loadLive(lvid);
          return { success: true, lvid };
        }
        return { success: false, error: 'stsen.loadLive not available' };
      }

      case 'detect-live': {
        if (typeof window.stsen !== 'undefined' && window.stsen.detectCurrentLive) {
          const res = await window.stsen.detectCurrentLive();
          if (res && res.lvid) {
            await window.stsen.loadLive(res.lvid);
            return { success: true, lvid: res.lvid, title: res.liveinfo && res.liveinfo.program ? res.liveinfo.program.title : '' };
          }
          return { success: false, error: '放送中の配信が見つかりませんでした' };
        }
        return { success: false };
      }

      // --- 再生制御 ---
      case 'play-next': {
        const btn = document.querySelector('#btn-play-next');
        if (btn) {
          btn.click();
          return { success: true };
        }
        if (typeof NicoLiveHelper !== 'undefined' && NicoLiveHelper.playNext) {
          NicoLiveHelper.playNext();
          return { success: true };
        }
        throw new Error('playNext button not found');
      }

      case 'stop-play': {
        const btn = document.querySelector('#btn-stop-play');
        if (btn) {
          btn.click();
          return { success: true };
        }
        if (typeof NicoLiveHelper !== 'undefined' && NicoLiveHelper.stopPlay) {
          NicoLiveHelper.stopPlay();
          return { success: true };
        }
        throw new Error('stopPlay button not found');
      }

      case 'resend-info': {
        const btn = document.querySelector('#btn-resend-info');
        if (btn) {
          btn.click();
          return { success: true };
        }
        return { success: false };
      }

      case 'play-video': {
        const vid = String(params.videoId || '').trim();
        if (!vid) throw new Error('videoId is required');
        if (typeof NicoLiveHelper !== 'undefined' && NicoLiveHelper.play) {
          await NicoLiveHelper.play(vid);
          return { success: true, videoId: vid };
        }
        throw new Error('NicoLiveHelper.play not available');
      }

      // --- ストック操作 ---
      case 'stock-add': {
        const vid = String(params.videoId || '').trim();
        if (!vid) throw new Error('videoId is required');
        if (typeof NicoLiveStock !== 'undefined' && NicoLiveStock.add) {
          await NicoLiveStock.add(vid);
          this.notifyStateUpdate();
          return { success: true, videoId: vid };
        }
        throw new Error('NicoLiveStock.add not available');
      }

      case 'stock-remove': {
        const index = parseInt(params.index, 10);
        if (isNaN(index)) throw new Error('valid index is required');
        if (typeof NicoLiveStock !== 'undefined' && Array.isArray(NicoLiveStock.stock)) {
          if (index >= 0 && index < NicoLiveStock.stock.length) {
            NicoLiveStock.stock.splice(index, 1);
            if (NicoLiveStock.createTable) NicoLiveStock.createTable();
            if (NicoLiveStock.saveStocks) NicoLiveStock.saveStocks();
            this.notifyStateUpdate();
            return { success: true, index };
          }
        }
        throw new Error('stock index out of range');
      }

      case 'stock-clear': {
        if (typeof NicoLiveStock !== 'undefined') {
          NicoLiveStock.stock = [];
          if (NicoLiveStock.createTable) NicoLiveStock.createTable();
          if (NicoLiveStock.saveStocks) NicoLiveStock.saveStocks();
          this.notifyStateUpdate();
          return { success: true };
        }
        throw new Error('NicoLiveStock not available');
      }

      case 'stock-shuffle': {
        const btn = document.querySelector('#btn-shuffle-stock');
        if (btn) {
          btn.click();
          this.notifyStateUpdate();
          return { success: true };
        }
        return { success: false };
      }

      // --- リクエスト操作 ---
      case 'request-allow': {
        const status = parseInt(params.status, 10); // 0: 許可, 1: 不可
        const sel = document.querySelector('#sel-allow-request');
        if (sel) {
          sel.value = String(status);
          $(sel).trigger('change');
          this.notifyStateUpdate();
          return { success: true, status };
        }
        throw new Error('#sel-allow-request not found');
      }

      case 'request-add': {
        const vid = String(params.videoId || '').trim();
        if (!vid) throw new Error('videoId is required');
        if (typeof NicoLiveRequest !== 'undefined' && NicoLiveRequest.add) {
          await NicoLiveRequest.add(vid);
          this.notifyStateUpdate();
          return { success: true, videoId: vid };
        }
        throw new Error('NicoLiveRequest.add not available');
      }

      case 'request-adopt': {
        // リクエストをストックへ移動（採用）
        const index = parseInt(params.index, 10);
        if (isNaN(index)) throw new Error('valid index is required');
        if (typeof NicoLiveRequest !== 'undefined' && Array.isArray(NicoLiveRequest.request)) {
          const reqItem = NicoLiveRequest.request[index];
          if (reqItem) {
            if (typeof NicoLiveStock !== 'undefined') {
              await NicoLiveStock.add(reqItem.video_id);
            }
            NicoLiveRequest.request.splice(index, 1);
            if (NicoLiveRequest.createTable) NicoLiveRequest.createTable();
            this.notifyStateUpdate();
            return { success: true, adopted: reqItem.video_id };
          }
        }
        throw new Error('request item not found');
      }

      case 'request-remove': {
        const index = parseInt(params.index, 10);
        if (isNaN(index)) throw new Error('valid index is required');
        if (typeof NicoLiveRequest !== 'undefined' && Array.isArray(NicoLiveRequest.request)) {
          if (index >= 0 && index < NicoLiveRequest.request.length) {
            NicoLiveRequest.request.splice(index, 1);
            if (NicoLiveRequest.createTable) NicoLiveRequest.createTable();
            this.notifyStateUpdate();
            return { success: true, index };
          }
        }
        throw new Error('request index out of range');
      }

      case 'request-clear': {
        if (typeof NicoLiveRequest !== 'undefined') {
          NicoLiveRequest.request = [];
          if (NicoLiveRequest.createTable) NicoLiveRequest.createTable();
          this.notifyStateUpdate();
          return { success: true };
        }
        throw new Error('NicoLiveRequest not available');
      }

      // --- プレイスタイル変更 ---
      case 'set-playstyle': {
        const style = parseInt(params.style, 10); // 0:手動, 1:自動順次, 2:自動ランダム
        const sel = document.querySelector('#sel-playstyle');
        if (sel) {
          sel.value = String(style);
          $(sel).trigger('change');
          this.notifyStateUpdate();
          return { success: true, style };
        }
        throw new Error('#sel-playstyle not found');
      }

      // --- コメント送信 ---
      case 'post-comment': {
        const text = String(params.text || '').trim();
        const mail = String(params.mail || '');
        if (!text) throw new Error('comment text is required');
        if (typeof NicoLiveHelper !== 'undefined' && NicoLiveHelper.postComment) {
          await NicoLiveHelper.postComment(text, mail);
          return { success: true };
        }
        throw new Error('NicoLiveHelper.postComment not available');
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
};

// 起動時に自動初期化
$(document).ready(() => {
  window.RemoteHostBridge.init();
});
