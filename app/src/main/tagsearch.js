/*
 Copyright (c) 2026

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

var NicoLiveTagSearch = {
    _timer: null,
    _lastSearchTime: 0,
    _isSearching: false,

    init: function(){
        this.setupEventListeners();
        this.setupAutoTimer();
    },

    setupEventListeners: function(){
        // 手動タグ追加ボタンのクリック
        $( '#btn-tag-search-add' ).on( 'click', ( ev ) => {
            ev.preventDefault();
            this.handleManualAddClick();
        } );

        // ドロップダウンの「タグを指定して追加」
        $( '#menu-tag-search-prompt' ).on( 'click', ( ev ) => {
            ev.preventDefault();
            let currentTag = Config['tag-search-tag'] || '';
            let tag = prompt( '検索するタグを入力してください:', currentTag );
            if( tag !== null && tag.trim().length > 0 ){
                this.searchAndAdd( tag.trim(), null, false );
            }
        } );

        // ドロップダウンの「設定タグで即時追加」
        $( '#menu-tag-search-exec' ).on( 'click', ( ev ) => {
            ev.preventDefault();
            let tag = Config['tag-search-tag'];
            if( !tag || tag.trim().length === 0 ){
                let promptTag = prompt( '指定タグが設定されていません。タグを入力してください:' );
                if( promptTag !== null && promptTag.trim().length > 0 ){
                    this.searchAndAdd( promptTag.trim(), null, false );
                }
                return;
            }
            this.searchAndAdd( tag.trim(), null, false );
        } );
    },

    handleManualAddClick: async function() {
        let tag = Config['tag-search-tag'];
        if (!tag || tag.trim().length === 0) {
            let promptTag = await ShowPromptDialog('検索するタグを入力してください:');
            if (promptTag !== null && promptTag.trim().length > 0) {
                this.searchAndAdd(promptTag.trim(), null, false);
            }
            return;
        }
        this.searchAndAdd(tag.trim(), null, false);
    },

    /**
     * スナップショットAPIで指定タグの動画を検索し、ストックに追加する
     * @param {string} tag 検索タグ（nullの場合はConfigのタグ）
     * @param {object} options 検索オプション
     * @param {boolean} isAuto 自動追加呼び出しフラグ
     */
    searchAndAdd: function( tag, options, isAuto ){
        if( this._isSearching ){
            console.log( 'Tag search is already in progress.' );
            return;
        }

        tag = tag || Config['tag-search-tag'];
        if( !tag || tag.trim().length === 0 ){
            if( !isAuto ){
                NicoLiveHelper.showAlert( 'タグが指定されていません。' );
            }
            return;
        }

        options = options || {};
        let searchOptions = {
            targets: options.targets || Config['tag-search-targets'] || 'tagsExact',
            sort: options.sort || Config['tag-search-sort'] || '-startTime',
            limit: options.limit || Config['tag-search-limit'] || 10
        };

        this._isSearching = true;
        this._lastSearchTime = Date.now();

        console.log( `スナップショットAPIでタグ「${tag}」を検索します (limit: ${searchOptions.limit}, sort: ${searchOptions.sort})` );

        let self = this;
        NicoApi.snapshotSearch( tag, searchOptions, function( xml, req ){
            self._isSearching = false;
            if( req && req.status == 200 ){
                try{
                    let res = JSON.parse( req.responseText );
                    if( res && res.meta && res.meta.status == 200 && Array.isArray( res.data ) ){
                        self.processSearchResults( tag, res.data, isAuto );
                    }else{
                        let msg = `タグ「${tag}」の検索に失敗しました。`;
                        console.error( msg, res );
                        if( !isAuto ) NicoLiveHelper.showAlert( msg );
                    }
                }catch( e ){
                    console.error( 'Failed to parse snapshot response:', e );
                    if( !isAuto ) NicoLiveHelper.showAlert( '検索結果の解析に失敗しました。' );
                }
            }else{
                let status = req ? req.status : '不明';
                let msg = `スナップショットAPIへの通信に失敗しました (status: ${status})`;
                console.error( msg );
                if( !isAuto ) NicoLiveHelper.showAlert( msg );
            }
        } );
    },

    /**
     * 検索結果の動画をストックに追加
     * @param {string} tag
     * @param {Array} items
     * @param {boolean} isAuto
     */
    processSearchResults: function( tag, items, isAuto ){
        let preventDuplicate = Config['tag-search-prevent-duplicate'];
        let existingStockIds = new Set();
        if( NicoLiveStock && Array.isArray( NicoLiveStock.stock ) ){
            for( let item of NicoLiveStock.stock ){
                if( item && item.video_id ){
                    existingStockIds.add( item.video_id );
                }
            }
        }

        let historyIds = new Set();
        if( preventDuplicate && NicoLiveHistory && Array.isArray( NicoLiveHistory.history ) ){
            for( let h of NicoLiveHistory.history ){
                if( h && h.video_id ){
                    historyIds.add( h.video_id );
                }
            }
        }

        let ngVideos = (NicoLiveRequest && NicoLiveRequest.ngvideos) ? NicoLiveRequest.ngvideos : {};

        let addedVideos = [];
        for( let item of items ){
            let id = item.contentId;
            if( !id ) continue;

            // ストック内の重複確認
            if( existingStockIds.has( id ) ) continue;

            // 再生履歴の重複確認
            if( preventDuplicate && historyIds.has( id ) ) continue;

            // NG動画の確認
            if( Config['request-no-ngvideo'] && ngVideos[id] ) continue;

            addedVideos.push( id );
        }

        if( addedVideos.length === 0 ){
            let msg = `タグ「${tag}」の動画が検索されましたが、追加可能な新規動画がありませんでした。`;
            console.log( msg );
            if( !isAuto ){
                NicoLiveHelper.showAlert( msg );
            }
            return;
        }

        // ストックに追加
        for( let vid of addedVideos ){
            NicoLiveStock.addStock( vid );
        }

        let msg = `指定タグ「${tag}」から ${addedVideos.length} 件の動画をストックに追加しました。`;
        console.log( msg );
        NicoLiveHelper.showAlert( msg );
    },

    /**
     * 自動追加の条件を判定して実行する
     * @param {string} triggerReason 'stock-low' または 'interval'
     */
    checkAutoAdd: function( triggerReason ){
        if( !Config['tag-search-auto-add'] ) return;

        let tag = Config['tag-search-tag'];
        if( !tag || tag.trim().length === 0 ) return;

        if( this._isSearching ) return;

        // 最低クールダウン（30秒）
        let now = Date.now();
        if( now - this._lastSearchTime < 30 * 1000 ) return;

        let triggerSetting = Config['tag-search-auto-trigger'] || 'stock-low';

        if( triggerReason === 'stock-low' ){
            if( triggerSetting !== 'stock-low' && triggerSetting !== 'both' ) return;

            // 残りの未再生ストック件数を取得
            let remaining = 0;
            if( NicoLiveStock && Array.isArray( NicoLiveStock.stock ) ){
                NicoLiveStock.stock.forEach( function( item ){
                    if( item && !item.is_played && !item.no_live_play ) remaining++;
                } );
            }
            let threshold = parseInt( Config['tag-search-stock-threshold'] ) || 3;
            if( remaining <= threshold ){
                console.log( `ストック残数が閾値以下 (${remaining} <= ${threshold}) のため、指定タグ動画を自動追加します。` );
                this.searchAndAdd( tag.trim(), null, true );
            }
        }else if( triggerReason === 'interval' ){
            if( triggerSetting !== 'interval' && triggerSetting !== 'both' ) return;

            let intervalMinutes = parseInt( Config['tag-search-auto-interval'] ) || 15;
            let intervalMs = intervalMinutes * 60 * 1000;
            if( now - this._lastSearchTime >= intervalMs ){
                console.log( `定期インターバル (${intervalMinutes}分) が経過したため、指定タグ動画を自動追加します。` );
                this.searchAndAdd( tag.trim(), null, true );
            }
        }
    },

    setupAutoTimer: function(){
        if( this._timer ){
            clearInterval( this._timer );
            this._timer = null;
        }

        // 1分毎に定期チェック
        this._timer = setInterval( () => {
            this.checkAutoAdd( 'interval' );
        }, 60 * 1000 );
    }
};
