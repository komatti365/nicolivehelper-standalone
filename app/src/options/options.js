
async function initAccountSettings() {
  const updateStatus = async () => {
    if (typeof window.stsen !== 'undefined' && window.stsen.getAccountStatus) {
      try {
        const status = await window.stsen.getAccountStatus();
        if (status && status.loggedIn) {
          $('#opt-account-status').text('ログイン中').css('color', '#28a745');
          const name = (status.user && status.user.nickname) || '';
          const id = (status.user && status.user.id) ? '(ID: ' + status.user.id + ')' : '';
          $('#opt-account-details').text(name + ' ' + id);
          $('#opt-btn-login').text('再ログイン');
          $('#opt-btn-logout').show();
        } else {
          $('#opt-account-status').text('未ログイン').css('color', '#dc3545');
          $('#opt-account-details').text('※ブラウザでログインしてください');
          $('#opt-btn-login').text('ログイン');
          $('#opt-btn-logout').hide();
        }
      } catch (e) {
        console.error('Failed to get account status:', e);
      }
    }
  };

  if (typeof window.stsen !== 'undefined') {
    $('#opt-btn-login').on('click', () => {
      window.stsen.openLoginWindow();
    });
    $('#opt-btn-logout').on('click', async () => {
      if (confirm('ニコニコからログアウトしますか？')) {
        await window.stsen.logout();
        updateStatus();
      }
    });
    window.stsen.onAccountStatusChanged(() => {
      updateStatus();
    });
    updateStatus();
  }
}

/*
 Copyright (c) 2017-2018 amano <amano@miku39.jp>

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */



function LoadValue( key, config, defvalue ){
    if( config[key] != undefined ){
        document.querySelector( `#${key}` ).value = config[key];
    }else{
        document.querySelector( `#${key}` ).value = defvalue;
    }
}

function LoadBool( key, config, defvalue ){
    document.querySelector( `#${key}` ).checked = config[key] || defvalue;
}

function SaveValue( key, config ){
    config[key] = document.querySelector( `#${key}` ).value;
}

function SaveInt( key, config ){
    config[key] = parseInt( document.querySelector( `#${key}` ).value );
}

function SaveNumber( key, config ){
    config[key] = document.querySelector( `#${key}` ).value * 1;
}

function SaveBool( key, config, value ){
    config[key] = document.querySelector( `#${key}` ).checked;
}


let g_vinfokey = [
    "vinfo-command-1",
    "vinfo-comment-1",
    "vinfo-command-2",
    "vinfo-comment-2",
    "vinfo-command-3",
    "vinfo-comment-3",
    "vinfo-command-4",
    "vinfo-comment-4"
];

let g_vinfo_defvalue = [
    '',
    '♪時間:{length} 再生数:{view} コメント:{comment} マイリスト:{mylist}',
    '',
    '♪{id} {title} 投稿日:{date}',
    '',
    '',
    '',
    ''
];



/**
 * 設定をロードして画面に反映.
 * @returns {Promise<void>}
 */
async function LoadOptions(){
    let result = await browser.storage.local.get( 'config' );
    console.log( result );

    let config = result.config || {};

    /* リモートホスト設定 */
    LoadBool( 'remote-server-enabled', config, false );
    LoadValue( 'remote-server-port', config, 18767 );
    LoadValue( 'remote-server-password', config, '' );

    if (typeof window.stsen !== 'undefined' && window.stsen.getRemoteServerStatus) {
        window.stsen.getRemoteServerStatus().then(status => {
            if (status && status.running) {
                $('#opt-remote-server-status-badge').text(`稼働中 (ポート ${status.port})`).css('background', '#28a745');
            } else {
                $('#opt-remote-server-status-badge').text('停止中').css('background', '#6c757d');
            }
        });
    }

    /* 進行 */
    LoadValue( 'play-default-volume', config, Config['play-default-volume'] );
    LoadValue( 'autoplay-interval', config, Config['autoplay-interval'] );
    LoadBool( 'play-in-time', config, Config['play-in-time'] );
    LoadBool( 'auto-extend', config, Config['auto-extend'] );
    LoadBool( 'auto-start', config, Config['auto-start'] );
    LoadBool( 'auto-start-quote', config, Config['auto-start-quote'] );
    LoadBool( 'auto-connect-on-start', config, Config['auto-connect-on-start'] );
    LoadBool( 'auto-open', config, Config['auto-open'] );
    LoadBool( 'auto-close', config, Config['auto-close'] );
    LoadBool( 'auto-create-next', config, Config['auto-create-next'] );
    LoadBool( 'auto-close-livepage', config, Config['auto-close-livepage'] );

    /* リクエスト */
    LoadValue( 'max-request', config, Config['max-request'] );
    LoadBool( 'request-no-duplicated', config, Config['request-no-duplicated'] );
    LoadBool( 'request-no-played', config, Config['request-no-played'] );
    LoadBool( 'request-no-ngvideo', config, Config['request-no-ngvideo'] );
    LoadValue( 'request-allow-n-min-elapsed', config, Config['request-allow-n-min-elapsed'] );

    LoadBool( 'request-send-reply', config, Config['request-send-reply'] );
    LoadValue( 'request-broadcaster-name', config, Config['request-broadcaster-name'] );
    LoadValue( 'request-anonymous-name', config, Config['request-anonymous-name'] );
    LoadValue( 'request-accept', config, Config['request-accept'] );
    LoadValue( 'request-not-allow', config, Config['request-not-allow'] );
    LoadValue( 'request-no-live-play', config, Config['request-no-live-play'] );
    LoadValue( 'request-deleted', config, Config['request-deleted'] );
    LoadValue( 'request-duplicated', config, Config['request-duplicated'] );
    LoadValue( 'request-played', config, Config['request-played'] );
    LoadValue( 'request-ngvideo', config, Config['request-ngvideo'] );
    LoadValue( 'request-max-request', config, Config['request-max-request'] );

    LoadValue( 'ng-video-list', config, Config['ng-video-list'] );

    /* コメント */
    LoadBool( 'comment-184', config, false );
    LoadBool( 'auto-kotehan', config, false );
    LoadValue( 'comment-dispay-lines', config, 500 );
    LoadValue( 'comment-backlog-num', config, 50 );

    /* 動画情報 */
    LoadValue( 'videoinfo-interval', config, 7 );
    let i = 0;
    for( let k of g_vinfokey ){
        LoadValue( k, config, g_vinfo_defvalue[i] );
        i++;
    }
    LoadValue( 'pname-whitelist', config, '' );



    /* Discord */
    LoadBool( 'discord-on-play', config, Config['discord-on-play'] );
    LoadValue( 'discord-text', config, Config['discord-text'] );
    LoadBool( 'discord-on-request', config, Config['discord-on-request'] );
    LoadValue( 'discord-request-text', config, Config['discord-request-text'] );
    LoadValue( 'discord-webhook-url', config, '' );
    // make sure the helper knows the current URL right away
    if( config['discord-webhook-url'] ){
        Discord.webhookUrl = config['discord-webhook-url'];
    }

    $( '#btn-test-discord' ).on( 'click', ( ev ) => {
        // make sure a webhook URL has been entered before attempting to send
        let url = $( '#discord-webhook-url' ).val().trim();
        if( url === '' ){
            alert( 'Discord のウェブフック URL が設定されていません。送信するには URL を入力してください。' );
            return;
        }
        // update the Discord helper immediately so the test can use it
        Discord.webhookUrl = url;
        // also mirror it in the temporary config object so that SaveOptions will
        // pick it up (but we don't persist here yet).
        Config['discord-webhook-url'] = url;

        let text = $( '#txt-discord-test' ).val();
        Discord.updateStatus( text );
    } );

    /* コメント読み上げ */
    LoadBool( 'do-speech', config, Config['do-speech'] );
    LoadBool( 'do-speech-caster-comment', config, Config['do-speech-caster-comment'] );

    let voice_select = $( '#webspeech-select-voice' );
    // 音声キャラクタリストを作成
    this._webvoices = speechSynthesis.getVoices();
    for( let i = 0; i < this._webvoices.length; i++ ){
        let item = document.createElement( 'option' );
        item.setAttribute( 'value', i );
        item.appendChild( document.createTextNode( this._webvoices[i].name ) );
        voice_select.append( item );
    }
    LoadValue( 'webspeech-select-voice', config, Config['webspeech-select-voice'] );
    LoadValue( 'webspeech-volume', config, Config['webspeech-volume'] );
    LoadValue( 'webspeech-speed', config, Config['webspeech-speed'] );

    /* 指定タグ動画追加 */
    LoadValue( 'tag-search-tag', config, Config['tag-search-tag'] );
    LoadValue( 'tag-search-targets', config, Config['tag-search-targets'] );
    LoadValue( 'tag-search-sort', config, Config['tag-search-sort'] );
    LoadValue( 'tag-search-limit', config, Config['tag-search-limit'] );
    LoadBool( 'tag-search-prevent-duplicate', config, Config['tag-search-prevent-duplicate'] );
    LoadBool( 'tag-search-auto-add', config, Config['tag-search-auto-add'] );
    LoadValue( 'tag-search-auto-trigger', config, Config['tag-search-auto-trigger'] );
    LoadValue( 'tag-search-stock-threshold', config, Config['tag-search-stock-threshold'] );
    LoadValue( 'tag-search-auto-interval', config, Config['tag-search-auto-interval'] );
}

function SaveOptions( ev ){
    ev.preventDefault();
    console.log( 'save settings' );

    let config = {};

    /* リモートホスト設定 */
    SaveBool( 'remote-server-enabled', config );
    SaveInt( 'remote-server-port', config );
    SaveValue( 'remote-server-password', config );

    /* 進行 */
    SaveInt( 'play-default-volume', config );
    SaveInt( 'autoplay-interval', config );
    SaveBool( 'play-in-time', config );
    SaveBool( 'auto-extend', config );
    SaveBool( 'auto-start', config );
    SaveBool( 'auto-start-quote', config );
    SaveBool( 'auto-connect-on-start', config );
    SaveBool( 'auto-open', config );
    SaveBool( 'auto-close', config );
    SaveBool( 'auto-create-next', config );
    SaveBool( 'auto-close-livepage', config );

    /* リクエスト */
    SaveInt( 'max-request', config );
    SaveBool( 'request-no-duplicated', config );
    SaveBool( 'request-no-played', config );
    SaveBool( 'request-no-ngvideo', config );
    SaveInt( 'request-allow-n-min-elapsed', config );

    SaveBool( 'request-send-reply', config );
    SaveValue( 'request-broadcaster-name', config );
    SaveValue( 'request-anonymous-name', config );
    SaveValue( 'request-accept', config );
    SaveValue( 'request-not-allow', config );
    SaveValue( 'request-no-live-play', config );
    SaveValue( 'request-deleted', config );
    SaveValue( 'request-duplicated', config );
    SaveValue( 'request-played', config );
    SaveValue( 'request-ngvideo', config );
    SaveValue( 'request-max-request', config );

    SaveValue( 'ng-video-list', config );

    /* コメント */
    SaveBool( 'comment-184', config );
    SaveBool( 'auto-kotehan', config );
    SaveInt( 'comment-dispay-lines', config );
    SaveInt( 'comment-backlog-num', config );

    /* 動画情報 */
    SaveInt( 'videoinfo-interval', config );
    for( let k of g_vinfokey ){
        SaveValue( k, config );
    }
    SaveValue( 'pname-whitelist', config );


    /* Discord */
    SaveBool( 'discord-on-play', config );
    SaveValue( 'discord-webhook-url', config );
    SaveValue( 'discord-text', config );
    SaveBool( 'discord-on-request', config );
    SaveValue( 'discord-request-text', config );

    /* コメント読み上げ */
    SaveBool( 'do-speech', config );
    SaveBool( 'do-speech-caster-comment', config );
    SaveValue( 'webspeech-select-voice', config );
    SaveNumber( 'webspeech-volume', config );
    SaveNumber( 'webspeech-speed', config );

    /* 指定タグ動画追加 */
    SaveValue( 'tag-search-tag', config );
    SaveValue( 'tag-search-targets', config );
    SaveValue( 'tag-search-sort', config );
    SaveInt( 'tag-search-limit', config );
    SaveBool( 'tag-search-prevent-duplicate', config );
    SaveBool( 'tag-search-auto-add', config );
    SaveValue( 'tag-search-auto-trigger', config );
    SaveInt( 'tag-search-stock-threshold', config );
    SaveInt( 'tag-search-auto-interval', config );

    browser.storage.local.set( {
        'config': config
    } );

    if (typeof window.stsen !== 'undefined' && window.stsen.updateRemoteServerConfig) {
        window.stsen.updateRemoteServerConfig({
            enabled: config['remote-server-enabled'],
            port: config['remote-server-port'],
            password: config['remote-server-password']
        }).then(status => {
            if (status && status.running) {
                $('#opt-remote-server-status-badge').text(`稼働中 (ポート ${status.port})`).css('background', '#28a745');
            } else {
                $('#opt-remote-server-status-badge').text('停止中').css('background', '#6c757d');
            }
        });
    }
}

window.addEventListener( 'load', async function( ev ){
    Talker.init();

    LoadOptions();
    initAccountSettings();

    $( '#btn-test-talk' ).on( 'click', ( ev ) => {
        let text = $( '#webspeech-test-text' ).val();
        let select = $( '#webspeech-select-voice' );
        let n = select.get( 0 ).selectedIndex;
        let vol = $( '#webspeech-volume' ).val() * 1;
        let spd = $( '#webspeech-speed' ).val() * 1;

        Talker.speech2( text, n, vol, spd );
    } );

    $( '#btn-save-config' ).on( 'click', ( ev ) => {
        SaveOptions( ev );
    } );

    $( '#btn-open-config-folder' ).on( 'click', () => {
        if ( window.stsen && window.stsen.openConfigFolder ) {
            window.stsen.openConfigFolder();
        }
    } );

    const handleResetAllData = () => {
        if ( window.stsen && window.stsen.resetAllData ) {
            window.stsen.resetAllData();
        }
    };
    $( '#btn-reset-all-data' ).on( 'click', handleResetAllData );
    $( '#btn-reset-all-data-bottom' ).on( 'click', handleResetAllData );

    $( '#opt-version-badge' ).on( 'click', () => {
        if ( window.stsen && window.stsen.showAboutDialog ) {
            window.stsen.showAboutDialog();
        } else if ( typeof browser !== 'undefined' && browser.runtime && browser.runtime.getManifest ) {
            const manifest = browser.runtime.getManifest();
            alert( `${manifest.name || 'New NicoLive Helper'}\nバージョン: v${manifest.version}` );
        }
    } );

    if ( typeof window.stsen !== 'undefined' && window.stsen.getVersion ) {
        const v = window.stsen.getVersion();
        $( '.app-version-text' ).text( v.startsWith('v') ? v : 'v' + v );
    }
} );
