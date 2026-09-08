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

var Discord = {
    /*
     * Discord webhook helper for NicoLiveHelper.
     * Instead of using OAuth, the user simply provides a webhook URL in
     * settings and messages are POSTed directly.
     */

    webhookUrl: "",

    init: function(){
        // read webhook URL from configuration if available; leave empty otherwise
        // Discord functionality is entirely optional, so the absence of a URL
        // must not prevent the rest of the extension from working.
        if( Config && typeof Config['discord-webhook-url'] === 'string' ){
            this.webhookUrl = Config['discord-webhook-url'] || "";
        } else {
            this.webhookUrl = "";
        }
    },

    /**
     * Send a plain text message through the configured webhook.
     * @param {string} text
     */
    updateStatus: function( text ){
        if( !this.webhookUrl ) return;
        let req = new XMLHttpRequest();
        req.open( 'POST', this.webhookUrl );
        req.setRequestHeader( 'Content-Type', 'application/json' );
        req.onreadystatechange = function(){
            if( req.readyState !== 4 ) return;
            if( req.status >= 400 || req.status === 0 ){
                console.log( 'Discord send failed', req.status, req.responseText );
                alert( 'Discord へのメッセージ送信に失敗しました。ステータス: ' + req.status + '\n' +
                      'URLと拡張機能の権限を確認してください。' );
            }
        };
        let payload = { content: text };
        req.send( JSON.stringify( payload ) );
    },

    /**
     * Send a message with an image attachment.  `picture` must be a data URI
     * (base64) string such as the one returned from a canvas.
     */
    updateStatusWithMedia: function( text, picture ){
        if( !this.webhookUrl ) return;
        let blob = this._base64ToBlob( picture );
        let form = new FormData();
        form.append( 'content', text || '' );
        form.append( 'file', blob, 'image.png' );
        let req = new XMLHttpRequest();
        req.open( 'POST', this.webhookUrl );
        req.onreadystatechange = function(){
            if( req.readyState !== 4 ) return;
            if( req.status >= 400 || req.status === 0 ){
                console.log( 'Discord upload failed', req.status, req.responseText );
                alert( 'Discord への画像付きメッセージ送信に失敗しました。ステータス: ' + req.status + '\n' +
                      'URLと拡張機能の権限を確認してください。' );
            }
        };
        req.send( form );
    },

    _base64ToBlob: function( dataURI ){
        let parts = dataURI.split( ',' );
        let mime = parts[0].match( /:(.*?);/ )[1];
        let bstr = atob( parts[1] );
        let n = bstr.length;
        let u8arr = new Uint8Array(n);
        while( n-- ){
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }
};
