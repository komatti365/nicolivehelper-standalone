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


var VideoDB = {
    search_result: [],

    initDB: function(){
        this.db = DB.initDB();
        console.log( this.db );
    },

    /**
     * スナップショットAPIの検索結果アイテムを VideoInformation オブジェクトに変換
     * @param {object} item 
     * @returns {VideoInformation}
     */
    convertSnapshotItemToVideoInfo: function( item ){
        let vinfo = (typeof VideoInformation !== 'undefined') ? new VideoInformation() : {};
        vinfo.video_id = item.contentId;
        vinfo.title = item.title || '';
        vinfo.description = item.description || '';
        vinfo.thumbnail_url = item.thumbnailUrl || '';
        vinfo.user_id = item.userId ? String( item.userId ) : '';
        vinfo.user_nickname = '';

        let sec = parseInt( item.lengthSeconds ) || 0;
        vinfo.length_ms = sec * 1000;
        let m = parseInt( sec / 60 );
        let s = sec % 60;
        vinfo.length = `${m}:${s < 10 ? '0' + s : s}`;

        vinfo.view_counter = parseInt( item.viewCounter ) || 0;
        vinfo.comment_num = parseInt( item.commentCounter ) || 0;
        vinfo.mylist_counter = parseInt( item.mylistCounter ) || 0;

        let startTime = item.startTime ? new Date( item.startTime ).getTime() : Date.now();
        vinfo.first_retrieve = parseInt( startTime / 1000 );

        vinfo.tags = {};
        vinfo.tags_array = [];
        if( item.tags ){
            let arr = item.tags.split( /\s+/ ).filter( t => t.length > 0 );
            vinfo.tags_array = arr;
            for( let t of arr ){
                vinfo.tags[t] = 1;
            }
        }
        vinfo.deleted = 0;
        return vinfo;
    },

    /**
     * スナップショット検索APIによる動画検索
     */
    searchSnapshot: function(){
        let query = $( '#snapshot-query' ).val();
        if( !query || query.trim().length === 0 ){
            $( '#information' ).text( '検索キーワードまたはタグを入力してください' );
            return;
        }
        query = query.trim();

        let targets = $( '#snapshot-targets' ).val() || 'tagsExact';
        let sort = $( '#snapshot-sort' ).val() || '-startTime';
        let limit = parseInt( $( '#snapshot-limit' ).val() ) || 100;

        $( '#information' ).text( `スナップショットAPIで「${query}」を検索中...` );
        $( '#tbl-result' ).empty();

        let options = {
            targets: targets,
            sort: sort,
            limit: limit,
            context: 'NicoLiveHelperX_VideoDB'
        };

        let self = this;
        NicoApi.snapshotSearch( query, options, async function( xml, req ){
            if( !req || req.status !== 200 ){
                let status = req ? req.status : '通信エラー';
                $( '#information' ).text( `スナップショットAPI検索に失敗しました (${status})` );
                return;
            }

            try{
                let res = JSON.parse( req.responseText );
                if( !res || !res.meta || res.meta.status !== 200 || !Array.isArray( res.data ) ){
                    let msg = (res && res.meta && res.meta.errorMessage) ? res.meta.errorMessage : '検索結果を取得できませんでした';
                    $( '#information' ).text( `検索エラー: ${msg}` );
                    return;
                }

                let items = res.data;
                let videoList = [];
                for( let item of items ){
                    let vinfo = self.convertSnapshotItemToVideoInfo( item );
                    videoList.push( vinfo );
                }

                // DBに既に登録されているか確認
                let existingIds = new Set();
                try{
                    let ids = videoList.map( v => v.video_id );
                    let found = await self.db.videodb.where( 'video_id' ).anyOf( ids ).toArray();
                    for( let f of found ){
                        existingIds.add( f.video_id );
                    }
                }catch( e ){
                    console.error( 'Error checking existing videos in DB:', e );
                }

                // 自動追加が有効ならDBに追加
                let autoAdd = $( '#chk-snapshot-auto-add-db' ).prop( 'checked' );
                if( autoAdd && videoList.length > 0 ){
                    try{
                        await self.db.videodb.bulkPut( videoList );
                        for( let v of videoList ){
                            existingIds.add( v.video_id );
                        }
                    }catch( e ){
                        console.error( 'Error auto adding to videodb:', e );
                    }
                }

                // テーブルにレンダリング
                $( '#tbl-result' ).empty();
                for( let vinfo of videoList ){
                    let elem = self.createListElement( vinfo );
                    if( existingIds.has( vinfo.video_id ) ){
                        let titleElem = elem.querySelector( '.video-title' );
                        if( titleElem ){
                            let badge = document.createElement( 'span' );
                            badge.className = 'badge-db-exist';
                            badge.textContent = 'DB済';
                            titleElem.insertBefore( badge, titleElem.firstChild );
                        }
                    }
                    $( '#tbl-result' ).append( elem );
                }

                self.search_result = videoList;
                let countMsg = `${videoList.length}件見つかりました`;
                if( autoAdd ){
                    countMsg += ' (動画DBに追加・更新完了)';
                }
                $( '#information' ).text( countMsg );

            }catch( e ){
                console.error( 'Failed to parse snapshot response:', e );
                $( '#information' ).text( '検索結果の解析に失敗しました' );
            }
        } );
    },

    /**
     * スナップショット検索結果を動画DBに追加
     * @param {boolean} selectedOnly 選択された行のみを追加するか
     */
    addSnapshotResultToDB: async function( selectedOnly = false ){
        if( !this.search_result || this.search_result.length === 0 ){
            $( '#information' ).text( '追加対象の検索結果がありません' );
            return;
        }

        let targets = [];
        if( selectedOnly ){
            let items = $( '.item_selected' );
            if( items.length === 0 ){
                $( '#information' ).text( '動画が選択されていません' );
                return;
            }
            for( let i = 0; i < items.length; i++ ){
                let ind = items[i].rowIndex;
                if( this.search_result[ind] ){
                    targets.push( this.search_result[ind] );
                }
            }
        }else{
            targets = this.search_result;
        }

        if( targets.length === 0 ) return;

        $( '#information' ).text( `動画DBに追加中... (${targets.length}件)` );
        try{
            await this.db.videodb.bulkPut( targets );
            $( '#information' ).text( `${targets.length}件を動画DBに追加・更新しました` );

            // テーブル上のバッジを更新
            let targetIds = new Set( targets.map( v => v.video_id ) );
            let rows = $( '#tbl-result tr' );
            for( let i = 0; i < rows.length; i++ ){
                if( this.search_result[i] && targetIds.has( this.search_result[i].video_id ) ){
                    let titleElem = rows[i].querySelector( '.video-title' );
                    if( titleElem && !titleElem.querySelector( '.badge-db-exist' ) ){
                        let badge = document.createElement( 'span' );
                        badge.className = 'badge-db-exist';
                        badge.textContent = 'DB済';
                        titleElem.insertBefore( badge, titleElem.firstChild );
                    }
                }
            }
        }catch( e ){
            console.error( 'Failed to bulkPut to videodb:', e );
            $( '#information' ).text( '動画DBへの追加に失敗しました' );
        }
    },

    /**
     * 検索条件を追加
     */
    addCondLine: function(){
        let t = document.querySelector( '#template-db-cond' );
        let clone2 = document.importNode( t.content, true );
        let elem = clone2.firstElementChild;
        $( '#db-condition' ).append( elem );
        return elem;
    },

    /**
     * 検索条件を削除
     * @param ev
     */
    removeCondLine: function( ev ){
        if( $( '.cond-line' ).length <= 1 ) return;
        RemoveElement( ev.target.parentNode );
    },

    addVideos: async function(){
        let str = $( '#input-video' ).val();
        if( str.length < 3 ) return;

        $( '#information' ).text( '動画を追加/更新しています...' );
        let l = str.match( /(sm|nm|so)\d+|\d{10}/g );
        if( l ){
            for( let i = 0, id; id = l[i]; i++ ){
                try{
                    let vinfo = await window.opener.NicoLiveHelper.getVideoInfo( id );
                    this.db.videodb.put( vinfo );
                    console.log( `${id}を追加しました` );
                }catch( e ){
                    console.log( `動画DBに追加失敗: ${id}` );
                }
            }
        }
        l = str.match( /mylist\/\d+/g );
        if( l ){
            for( let i = 0, mylist; mylist = l[i]; i++ ){
                let id = mylist.match( /mylist\/(\d+)/ )[1];
                let video_ids = await window.opener.NicoLiveMylist.retrieveVideoIdFromRSS( id );
                for( let v of video_ids ){
                    try{
                        let vinfo = await window.opener.NicoLiveHelper.getVideoInfo( v );
                        this.db.videodb.put( vinfo );
                        console.log( `${v}を追加しました` );
                    }catch( e ){
                        console.log( `動画DBに追加失敗: ${v}` );
                    }
                }
            }
        }

        $( '#information' ).text( 'DB追加/更新完了しました' );
        $( '#input-video' ).val( '' );
    },

    test: async function(){
        let d = await this.db.videodb.get( 'sm9' );
        console.log( d );

        let r = await this.db.videodb.where( 'view_counter' ).above( 10000 ).toArray();
        console.log( r );
    },

    createListElement: function( item ){
        let t = document.querySelector( '#template-video-info' );
        let clone2 = document.importNode( t.content, true );
        let elem = clone2.firstElementChild;
        let image = elem.querySelector( '.video-thumbnail' );

        let posteddate = GetDateString( item.first_retrieve * 1000, true );

        if( item.deleted != 0 ){
            $( elem ).addClass( "video-deleted" );
        }
        image.setAttribute( 'src', item.thumbnail_url );
        image.setAttribute( 'style', 'width:65px;height:50px;margin-right:8px;' );
        let details = elem.querySelector( '.video-details' );

        let min = parseInt( item.length_ms / 1000 / 60 );
        let sec = parseInt( item.length_ms / 1000 % 60 );

        $( elem.querySelector( '.video-title' ) ).text( `${item.video_id} ${item.title}` );
        $( elem.querySelector( '.open-page' ) ).attr( 'href', `http://www.nicovideo.jp/watch/${item.video_id}` );

        details.appendChild( document.createTextNode( "投稿:" + posteddate + " 時間:" + (min + ":" + (sec < 10 ? ("0" + sec) : sec)) ) );
        details.appendChild( document.createElement( 'br' ) );
        details.appendChild( document.createTextNode( "再生:" + FormatCommas( item.view_counter )
            + " コメント:" + FormatCommas( item.comment_num )
            + " マイリスト:" + FormatCommas( item.mylist_counter ) ) );

        return elem;
    },


    searchVideos: async function(){
        $( '#information' ).text( '検索しています...' );
        let types = $( '.search-type' );
        let conds = $( '.search-cond' );
        let vals = $( '.search-value' );
        let n = types.length;

        let filter_func = [];
        for( let i = 0; i < n; i++ ){
            let t = $( types[i] ).val();
            let c = $( conds[i] ).val();
            let v = $( vals[i] ).val();
            if( !v ) continue;
            if( t == 'length_ms' ){
                v *= 1000;
            }

            if( t == 'first_retrieve' ){
                let date;
                let d;
                let tmp;
                date = v.match( /\d+/g );
                if( date.length == 6 ){
                    d = new Date( date[0], date[1] - 1, date[2], date[3], date[4], date[5] );
                    tmp = parseInt( d.getTime() / 1000 ); // integer
                }else{
                    d = new Date( date[0], date[1] - 1, date[2], 0, 0, 0 );
                    tmp = parseInt( d.getTime() / 1000 ); // integer
                }
                v = tmp;
            }

            switch( c ){
            case 'include':
                filter_func.push( ( item ) =>{
                    let reg = new RegExp( v, 'i' );
                    if( t == 'tags_array' ){
                        for( let t of item.tags_array ){
                            if( t.match( reg ) ){
                                return true;
                            }
                        }
                        return false;
                    }else{
                        return item[t].match( reg );
                    }
                } );
                break;
            case 'exclude':
                filter_func.push( ( item ) =>{
                    let reg = new RegExp( v, 'i' );
                    if( t == 'tags_array' ){
                        for( let t of item.tags_array ){
                            if( t.match( reg ) ){
                                return false;
                            }
                        }
                        return true;
                    }else{
                        return !item[t].match( reg );
                    }
                } );
                break;
            case 'greater_than':
                filter_func.push( ( item ) =>{
                    return item[t] >= v;
                } );
                break;
            case 'less_than':
                filter_func.push( ( item ) =>{
                    return item[t] <= v;
                } );
                break;
            case 'equal':
            default:
                filter_func.push( ( item ) =>{
                    return item[t] == v;
                } );
                break;
            }
        }

        let limit = $( '#display-num' ).val() * 1;
        let result = await this.db.videodb.filter( ( item ) =>{
            for( let f of filter_func ){
                let flg = f( item );
                if( !flg ) return false;
            }
            return true;
        } ).toArray();

        let sorttype = $( '#sort-type' ).val() * 1;
        let order = $( '#sort-order' ).val() * 1;
        if( order != 0 ){
            window.opener.NicoLiveHelper.sortVideoList( result, sorttype, order );
        }else{
            ShuffleArray( result );
        }

        result = result.slice( 0, limit )
        console.log( result );
        $( '#information' ).text( `${result.length}件見つかりました。` );

        $( '#tbl-result' ).empty();
        for( let vinfo of result ){
            let elem = this.createListElement( vinfo );
            $( '#tbl-result' ).append( elem );
        }
        this.search_result = result;
    },

    copyToClipboard: function( type ){
        let items = $( '.item_selected' );
        let str = "";

        let videos = this.search_result;
        for( let i = 0; i < items.length; i++ ){
            let ind = items[i].rowIndex;
            switch( type ){
            case 0:
                // 動画ID
                str += videos[ind].video_id + "\n";
                break;
            case 1:
                // タイトル
                str += videos[ind].title + "\n";
                break;
            case 2:
                // 動画ID+タイトル
                str += videos[ind].video_id + "\t" + videos[ind].title + "\n";
                break;
            }
        }
        CopyToClipboard( str );
    },

    /**
     * ファイルに保存する
     */
    saveToFile: function(){
        let videos = this.search_result;

        let str = "";
        for( let i = 0; i < videos.length; i++ ){
            str += videos[i].video_id + "\t" + videos[i].title + "\r\n";
        }

        SaveText( 'videodb.txt', str );
    },

    /**
     * ストックに追加する
     */
    addToStock: function(){
        let items = $( '.item_selected' );
        let str = "";
        let videos = this.search_result;
        for( let i = 0; i < items.length; i++ ){
            let ind = items[i].rowIndex;
            str += videos[ind].video_id + " ";
        }
        window.opener.NicoLiveStock.addStocks( str );
    },

    /**
     * チェックした動画を削除する.
     */
    delete: function(){
        if( !window.confirm( "選択した動画を動画DBから削除しますか?" ) ) return;

        let items = $( '.item_selected' );
        let videos = this.search_result;
        let ids = [];
        for( let i = 0; i < items.length; i++ ){
            let ind = items[i].rowIndex;
            let video_id = videos[ind].video_id;
            ids.push( video_id );
        }
        this.db.videodb.bulkDelete( ids );
    },

    loadSavedSearch: async function(){
        let result = await browser.storage.local.get( 'saved-search' );
        let saved = result['saved-search'] || {};
        console.log( saved );

        $( '#saved-search' ).empty();

        let option = document.createElement( 'option' );
        $( option ).attr( 'value', '' );
        $( option ).text( `保存された検索` );
        $( '#saved-search' ).append( option );

        for( let k of Object.keys( saved ) ){
            let option = document.createElement( 'option' );
            $( option ).attr( 'value', k );
            $( option ).text( `${k}` );
            $( '#saved-search' ).append( option );
        }
    },

    /**
     * 検索条件を保存する.
     */
    saveSearchCondition: async function(){
        let types = $( '.search-type' );
        let conds = $( '.search-cond' );
        let vals = $( '.search-value' );
        let n = types.length;

        let name = window.prompt( '検索条件に名前を指定してください' );
        if( !name ) return;

        let conditions = [];
        for( let i = 0; i < n; i++ ){
            let t = $( types[i] ).val();
            let c = $( conds[i] ).val();
            let v = $( vals[i] ).val();

            conditions.push( {
                'type': t,
                'cond': c,
                'value': v
            } );
        }

        let result = await browser.storage.local.get( 'saved-search' );
        let saved = result['saved-search'] || {};
        saved[name] = conditions;
        await browser.storage.local.set( {
            'saved-search': saved
        } );
        this.loadSavedSearch();
    },

    clearCondition: function(){
        let vals = $( '.search-value' );
        for( let v of vals ){
            $( v ).val( '' );
        }
    },

    /**
     * 保存した検索を削除
     * @returns {Promise<void>}
     */
    removeSavedSearch: async function(){
        let result = await browser.storage.local.get( 'saved-search' );
        let saved = result['saved-search'] || {};

        let k = $( '#saved-search' ).val();
        delete saved[k];

        await browser.storage.local.set( {
            'saved-search': saved
        } );
        this.loadSavedSearch();
    },


    /**
     * 保存した検索を実行する.
     * @returns {Promise<void>}
     */
    execSavedSearch: async function(){
        let key = $( '#saved-search' ).val();
        if( !key ) return;

        let result = await browser.storage.local.get( 'saved-search' );
        let saved = result['saved-search'] || {};

        this.clearCondition();
        let cond = $( '.cond-line' );
        for( let i = 0; i < cond.length; i++ ){
            RemoveElement( cond[i] );
        }

        let conditions = saved[key];
        for( let cond of conditions ){
            let elem = this.addCondLine();
            $( elem.querySelector( '.search-type' ) ).val( cond.type );
            $( elem.querySelector( '.search-cond' ) ).val( cond.cond );
            $( elem.querySelector( '.search-value' ) ).val( cond.value );
        }

        this.searchVideos();
    },

    /**
     * コンテキストメニューの実行.
     * @param key
     * @param options
     */
    contextMenu: function( key, options ){
        let elem = options.$trigger[0];
        let n = elem.sectionRowIndex;
        console.log( key );

        switch( key ){
        case 'add_db':
            this.addSnapshotResultToDB( true );
            break;

        case 'copy_vid':
            this.copyToClipboard( 0 );
            break;
        case 'copy_title':
            this.copyToClipboard( 1 );
            break;
        case 'copy_vid_title':
            this.copyToClipboard( 2 );
            break;

        case 'save':
            this.saveToFile();
            break;

        case 'stock':
            this.addToStock();
            break;

        case 'delete':
            this.delete();
            break;

        default:
            break;
        }
        // console.log( options.$trigger );
    },

    dropFile: function( ev ){
        console.log( ev.dataTransfer );
        if( ev.dataTransfer.items ){
            // Use DataTransferItemList interface to access the file(s)
            for( let i = 0; i < ev.dataTransfer.items.length; i++ ){
                // If dropped items aren't files, reject them
                switch( ev.dataTransfer.items[i].kind ){
                case 'string':
                    if( ev.dataTransfer.items[i].type === 'text/plain' ){
                        ev.dataTransfer.items[i].getAsString( ( str ) =>{
                            console.log( str );

                            $( '#input-video' ).val( str );
                            this.addVideos();
                        } );
                    }
                    break;

                case 'file':
                    let file = ev.dataTransfer.items[i].getAsFile();
                    console.log( '... file[' + i + '].name = ' + file.name );
                    if( file.name.match( /\.txt$/ ) ){
                        let fileReader = new FileReader();
                        fileReader.onload = ( ev ) =>{
                            let txt = ev.target.result;
                            $( '#input-video' ).val( txt );
                            this.addVideos();
                        };
                        fileReader.readAsText( file );
                    }
                    break;
                }
            }
        }
    },

    init: async function(){
        console.log( 'Video database init.' );

        this.initDB();
        this.loadSavedSearch();

        let n = await this.db.videodb.count();
        $( '#information' ).text( `動画DBには${n}件あります` );

        $( document ).on( 'click', '#tbl-result tr', ( ev ) =>{
            let tr = FindParentElement( ev.target, 'tr' );

            if( ev.originalEvent.metaKey || ev.originalEvent.ctrlKey ){
                // 複数選択
                if( $( tr ).hasClass( 'item_selected' ) ){
                    $( tr ).removeClass( 'item_selected' );
                }else{
                    $( tr ).addClass( 'item_selected' );
                    this._index = tr.rowIndex;
                }
            }else if( ev.originalEvent.shiftKey ){
                let rows = $( '#tbl-result tr' );
                let start = Math.min( this._index, tr.rowIndex );
                let end = Math.max( this._index, tr.rowIndex );
                for( let i = start; i <= end; i++ ){
                    $( rows[i] ).addClass( 'item_selected' );
                }
            }else{
                // 1個選択
                $( '#tbl-result tr' ).removeClass( 'item_selected' );
                $( tr ).addClass( 'item_selected' );
                this._index = tr.rowIndex;
            }

            $( '#information' ).text( `選択: ${$( '.item_selected' ).length}` );
        } );

        $.contextMenu( {
            selector: '.nico-video-row',
            build: function( $triggerElement, e ){
                let menuobj = {
                    zIndex: 10,
                    callback: function( key, options ){
                        VideoDB.contextMenu( key, options );
                    },
                    items: {
                        "add_db": {name: "選択した動画を動画DBに追加"},
                        "copy": {
                            name: "選択した動画をコピー",
                            items: {
                                "copy_vid": {name: "動画ID"},
                                "copy_title": {name: "タイトル"},
                                "copy_vid_title": {name: "動画ID＋タイトル"},
                            }
                        },
                        "stock": {name: "選択した動画をストックに追加"},

                        "sep1": "---------",
                        "delete": {name: "選択した動画を削除"},
                        "sep2": "---------",
                        "save": {name: 'ファイルに保存'}
                    }
                };
                return menuobj;
            },
        } );

        $( '#btn-add-db' ).on( 'click', ( ev ) =>{
            this.addVideos();
        } );
        $( '#btn-search' ).on( 'click', ( ev ) =>{
            this.searchVideos();
        } );

        $( '#btn-save' ).on( 'click', ( ev ) =>{
            this.saveSearchCondition();
        } );

        $( '#btn-remove-saved-search' ).on( 'click', ( ev ) =>{
            this.removeSavedSearch();
        } );

        $( '#saved-search' ).on( 'change', ( ev ) =>{
            this.execSavedSearch();
        } );

        this.addCondLine();
        $( document ).on( 'click', '.btn-add-cond', ( ev ) =>{
            this.addCondLine();
        } );
        $( document ).on( 'click', '.btn-remove-cond', ( ev ) =>{
            this.removeCondLine( ev );
        } );

        $( '#btn-test' ).on( 'click', ( ev ) =>{
            this.test();
        } );

        $( '#db-result' ).on( 'dragenter', ( ev ) =>{
            ev.preventDefault();
        } );
        $( '#db-result' ).on( 'dragover', ( ev ) =>{
            ev.preventDefault();
        } );
        $( '#db-result' ).on( 'drop', ( ev ) =>{
            ev.preventDefault();
            this.dropFile( ev.originalEvent );
        } );

        // スナップショット検索イベント
        $( '#btn-snapshot-search' ).on( 'click', ( ev ) =>{
            this.searchSnapshot();
        } );
        $( '#snapshot-query' ).on( 'keydown', ( ev ) =>{
            if( ev.which === 13 || ev.keyCode === 13 ){
                this.searchSnapshot();
            }
        } );
        $( '#btn-snapshot-add-all-db' ).on( 'click', ( ev ) =>{
            this.addSnapshotResultToDB( false );
        } );

    }
};


window.addEventListener( 'load', ( ev ) =>{
    VideoDB.init();
} );