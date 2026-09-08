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
function debugprint( str ){
    console.log( str );
}

function SetStatusBarText( str ){
    $( '#message' ).text( str );
}


// TODO XUL向けコードをいろいろ修正する
let MyListManager = {
    mylists: null,    // マイリスト一覧
    series: [],       // シリーズ一覧
    mylistdata: {}, // マイリストの内容(key=マイリストID or default)

    apitoken: "",   // トークンが必要なAPI用

    registerMylistQueue: [],

    sort: function( array, order ){
        array.sort( function( a, b ){
            let tmpa = 0, tmpb = 0;
            switch( order ){
            case 1:// 登録が新しい順
                tmpa = a.create_time;
                tmpb = b.create_time;
                break;
            case 0:// 登録が古い順
                tmpb = a.create_time;
                tmpa = b.create_time;
                break;
            case 4:// タイトル昇順
                tmpa = a.item_data.title;
                tmpb = b.item_data.title;
                return tmpa < tmpb ? -1 : 1;
                break;
            case 5:// タイトル降順
                tmpb = a.item_data.title;
                tmpa = b.item_data.title;
                return tmpa < tmpb ? -1 : 1;
                break;
            case 2:// マイリストコメント昇順
                tmpa = a.description;
                tmpb = b.description;
                return tmpa < tmpb ? -1 : 1;
                break;
            case 3:// マイリストコメント降順
                tmpb = a.description;
                tmpa = b.description;
                return tmpa < tmpb ? -1 : 1;
                break;
            case 6:// 投稿が新しい順
                tmpa = a.item_data.first_retrieve;
                tmpb = b.item_data.first_retrieve;
                break;
            case 7:// 投稿が古い順
                tmpb = a.item_data.first_retrieve;
                tmpa = b.item_data.first_retrieve;
                break;
            case 8:// 再生が多い順
                tmpa = a.item_data.view_counter;
                tmpb = b.item_data.view_counter;
                break;
            case 9:// 再生が少ない順
                tmpb = a.item_data.view_counter;
                tmpa = b.item_data.view_counter;
                break;
            case 10:// コメントが新しい順
                tmpa = a.item_data.update_time;
                tmpb = b.item_data.update_time;
                break;
            case 11:// コメントが古い順
                tmpb = a.item_data.update_time;
                tmpa = b.item_data.update_time;
                break;
            case 12:// コメントが多い順
                tmpa = a.item_data.num_res;
                tmpb = b.item_data.num_res;
                break;
            case 13:// コメントが少ない順
                tmpb = a.item_data.num_res;
                tmpa = b.item_data.num_res;
                break;
            case 14:// マイリスト登録が多い順
                tmpa = a.item_data.mylist_counter;
                tmpb = b.item_data.mylist_counter;
                break;
            case 15:// マイリスト登録が少ない順
                tmpb = a.item_data.mylist_counter;
                tmpa = b.item_data.mylist_counter;
                break;
            case 16:// 時間が長い順
                tmpa = a.item_data.length_seconds;
                tmpb = b.item_data.length_seconds;
                break;
            case 17:// 時間が短い順
                tmpb = a.item_data.length_seconds;
                tmpa = b.item_data.length_seconds;
                break;

            case 18:// 枚数が多い順
                break;
            case 19:// 枚数が少ない順
                break;

            }
            return (tmpb - tmpa);
        } );
    },

    doSort: function( order ){
        let id = $( '#mylist' ).val();
        let key = "_" + id;

        this.sort( this.mylistdata[key].mylistitem, parseInt( order ) );

        let folder_listbox = $( '#folder-item-listbox' );
        folder_listbox.empty();

        for( let i = 0, item; item = this.mylistdata[key].mylistitem[i]; i++ ){
            let listitem = this.createListItemElement( item );
            folder_listbox.append( listitem );
        }
    },

    /** 動画情報を表示しているリストアイテム要素を作成.
     * @param mylist_data 動画情報のオブジェクト
     */
    createListItemElement: function( mylist_data ){
        let t = document.querySelector( '#template-video-info' );
        let clone2 = document.importNode( t.content, true );
        let elem = clone2.firstElementChild;
        let image = elem.querySelector( '.video-thumbnail' );

        let item = mylist_data;
        let posteddate = item.video.registeredAt;//GetDateString( item.first_retrieve * 1000, true );

        if( item.video.title == '削除された動画' ){
            $( elem ).addClass( "video-deleted" );
        }
        image.setAttribute( 'src', item.video.thumbnail['url'] );
        image.setAttribute( 'style', 'width:65px;height:50px;margin-right:8px;' );
        let details = elem.querySelector( '.video-details' );

        let min = parseInt( item.video.duration / 60 );
        let sec = parseInt( item.video.duration % 60 );

        $( elem.querySelector( '.video-title' ) ).text( `${item.video.id} ${item.video.title}` );
        $( elem.querySelector( '.open-page' ) ).attr( 'href', `http://www.nicovideo.jp/watch/${item.video.id}` );

        let addedAtStr = item.addedAt ? " (登録:" + item.addedAt + ")" : "";
        details.appendChild( document.createTextNode( "投稿:" + posteddate + addedAtStr + " 時間:" + (min + ":" + (sec < 10 ? ("0" + sec) : sec)) ) );
        details.appendChild( document.createElement( 'br' ) );
        details.appendChild( document.createTextNode( "再生:" + FormatCommas( item.video.count.view )
            + " コメント:" + FormatCommas( item.video.count.comment )
            + " マイリスト:" + FormatCommas( item.video.count.mylist ) ) );

        return elem;
    },

    parseMyList: function( id, name, json ){
        let key = "_" + id;
        this.mylistdata[key] = JSON.parse( json );
        let mylistobj = this.mylistdata[key];
        console.log( mylistobj );

        /*
        {
	"0": {
		"itemId": 1291969444,
		"watchId": "sm12988567",
		"description": "",
		"decoratedDescriptionHtml": "",
		"addedAt": "2012-09-09T23:06:35+09:00",
		"status": "public",
		"video": {
			"type": "essential",
			"id": "sm12988567",
			"title": "【初音ミク】きみのうみ【オリジナル】",
			"registeredAt": "2010-12-10T17:24:02+09:00",
			"count": {
				"view": 7531,
				"comment": 111,
				"mylist": 341,
				"like": 1
			},
			"thumbnail": {
				"url": "https://nicovideo.cdn.nimg.jp/thumbnails/12988567/12988567",
				"middleUrl": null,
				"largeUrl": null,
				"listingUrl": "https://img.cdn.nimg.jp/s/nicovideo/thumbnails/12988567/12988567.original/r320x180l?key=d1a23010158088df7e066a7217489d8407fc6e70e39061d6aee60b9a42772d90",
				"nHdUrl": "https://img.cdn.nimg.jp/s/nicovideo/thumbnails/12988567/12988567.original/r640x360l?key=ff299b860237e80155c320a49ef934e6c2da11a8095c9ea0bcbaf84e2e50f4a5"
			},
			"duration": 273,
			"shortDescription": "はじめまして、こんにちは、かんぱねってと申します。海っぽい曲に出来上がってたら嬉しいですがどうでしょ",
			"latestCommentSummary": "GJ 。゜(゜´Д`゜)゜。 綺麗 wktk GJ!! なんという幻想系 癒されるなぁ・・・・ やばい、眠くな...",
			"isChannelVideo": false,
			"isPaymentRequired": false,
			"playbackPosition": null,
			"owner": {
				"ownerType": "user",
				"type": "user",
				"visibility": "visible",
				"id": "18897569",
				"name": "かんぱねって",
				"iconUrl": "https://secure-dcdn.cdn.nimg.jp/nicoaccount/usericon/1889/18897569.jpg?1324987243"
			},
			"requireSensitiveMasking": false,
			"videoLive": null,
			"isMuted": false,
			"9d091f87": false,
			"acf68865": false
                        }
                }
        }
         */
        if( this.mylistdata[key].meta.status != '200' ){
            $( '#message' ).text( this.mylistdata[key].error.description );
            return;
        }

        if( this.mylistdata[key].data.watchLater ){
            this.mylistdata[key].data.mylist = this.mylistdata[key].data.watchLater;
        }

        $( '#mylist-num' ).text( `${this.mylistdata[key].data.mylist.items.length} 件` );

        // TODO どのソート順を使用するかチェック
        // let sort_order = 1;
        // for( let i = 0, item; item = this.mylists.mylistgroup[i]; i++ ){
        //     if( item.id == id ){
        //         sort_order = item.default_sort;
        //         break;
        //     }
        // }
        // $( '#select-sort-order' ).val( sort_order );
        // this.sort( this.mylistdata[key].data.mylist.items, parseInt( sort_order ) );

        let folder_listbox = $( '#folder-item-listbox' );
        folder_listbox.empty();

        for( let i = 0, item; item = this.mylistdata[key].data.mylist.items[i]; i++ ){
            let listitem = this.createListItemElement( item );
            folder_listbox.append( listitem );
        }
    },

    loadMyList: function( id, name ){
        if( id && id.startsWith( 'series_' ) ){
            let seriesId = id.replace( 'series_', '' );
            this.loadSeries( seriesId, name );
            return;
        }

        $( '#message' ).text( name + 'を取得しています...' );

        debugprint( 'load mylist(id=' + id + ')' );
        let f = function( xml, req ){
            if( req.readyState == 4 ){
                $( '#message' ).text( '' );

                if( req.status == 200 ){
                    MyListManager.parseMyList( id, name, req.responseText );
                }
            }
        };
        if( id == 'default' ){
            NicoApi.getDeflist( f );
        }else{
            NicoApi.getmylist( id, f );
        }
    },

    loadSeries: function( id, name ){
        $( '#message' ).text( name + 'を取得しています...' );
        debugprint( 'load series(id=' + id + ')' );
        let f = function( xml, req ){
            if( req.readyState == 4 ){
                $( '#message' ).text( '' );
                if( req.status == 200 ){
                    MyListManager.parseSeries( id, name, req.responseText );
                }
            }
        };
        NicoApi.getSeries( id, f );
    },

    parseSeries: function( id, name, json ){
        let key = "_series_" + id;
        this.mylistdata[key] = JSON.parse( json );
        let seriesObj = this.mylistdata[key];

        if( seriesObj.meta && seriesObj.meta.status != 200 ){
            $( '#message' ).text( (seriesObj.error && seriesObj.error.description) || 'シリーズの取得に失敗しました' );
            return;
        }

        let items = (seriesObj.data && seriesObj.data.items) || [];
        seriesObj.data.mylist = { items: items };

        $( '#mylist-num' ).text( `${items.length} 件` );

        let folder_listbox = $( '#folder-item-listbox' );
        folder_listbox.empty();

        for( let i = 0, item; item = items[i]; i++ ){
            let listitem = this.createListItemElement( item );
            folder_listbox.append( listitem );
        }
    },

    getMylistGroup: function(){
        let folder = $( '#mylist' );
        let elem = document.createElement( 'option' );
        $( elem ).text( 'あとで見る' );
        $( elem ).attr( 'value', 'default' );
        folder.append( elem );

        $( '#message' ).text( "マイリスト・シリーズを取得しています..." );

        let fSeries = function( xml, req ){
            if( req.readyState == 4 && req.status == 200 ){
                try{
                    let res = JSON.parse( req.responseText );
                    if( res && res.data && Array.isArray( res.data.items ) && res.data.items.length > 0 ){
                        MyListManager.series = res.data.items;
                        let folder = $( '#mylist' );
                        let optgroup = document.createElement( 'optgroup' );
                        optgroup.setAttribute( 'label', 'シリーズ' );
                        for( let i = 0, s; s = res.data.items[i]; i++ ){
                            let elem = document.createElement( 'option' );
                            let countStr = s.itemsCount != null ? ` (${s.itemsCount})` : '';
                            $( elem ).text( s.title + countStr );
                            $( elem ).attr( 'value', 'series_' + s.id );
                            optgroup.appendChild( elem );
                        }
                        folder.append( optgroup );
                    }
                }catch( x ){
                    console.error( 'Failed to load series in MyListManager:', x );
                }
            }
        };

        let f = function( xml, req ){
            if( req.readyState == 4 ){
                $( '#message' ).text( "" );

                if( req.status == 200 ){
                    MyListManager.mylists = JSON.parse( req.responseText );

                    if( MyListManager.mylists.status == 'fail' ){
                        $( '#message' ).text( MyListManager.mylists.error.description );
                        return;
                    }

                    let folder = $( '#mylist' );
                    let optgroup = document.createElement( 'optgroup' );
                    optgroup.setAttribute( 'label', 'マイリスト' );
                    for( let i = 0, grp; grp = MyListManager.mylists.data.mylists[i]; i++ ){
                        let elem = document.createElement( 'option' );
                        $( elem ).text( grp.name );
                        $( elem ).attr( 'value', grp.id );
                        optgroup.appendChild( elem );
                    }
                    folder.append( optgroup );
                }
                NicoApi.getMySeries( fSeries );
            }
        };
        NicoApi.getmylistgroup( f );
    },

    getToken: function(){
        let f = function( xml, req ){
            if( req.readyState == 4 ){
                if( req.status == 200 ){
                    let token = req.responseText.match( /NicoAPI\.token\s*=\s*\"(.*)\";/ );
                    if( !token ){
                        token = req.responseText.match( /NicoAPI\.token\s*=\s*\'(.*)\';/ );
                    }
                    MyListManager.apitoken = token;
                }
            }
        };
        NicoApi.getUserMylistPageApiToken( f );
    },

    // TODO リクエスト追加処理を作成する
    addRequest: function(){
        let items = $( 'folder-item-listbox' ).children;
        let str = "";
        let id = $( 'folder-listbox' ).selectedItem.value;
        let key = "_" + id;

        let videos = this.mylistdata[key].mylistitem;
        for( let i = 0; i < items.length; i++ ){
            if( !items[i].selected ) continue;
            str += videos[i].item_data.video_id + " ";
        }
        if( window.opener.NicoLiveHelper.iscaster || window.opener.NicoLiveHelper.isOffline() ){
            window.opener.NicoLiveRequest.addRequest( str );
        }else{
            window.opener.NicoLiveHelper.postListenerComment( str, "" );
        }
    },
    // TODO ストック追加処理を作成する
    addStock: function(){
        let items = $( 'folder-item-listbox' ).children;
        let str = "";
        let id = $( 'folder-listbox' ).selectedItem.value;
        let key = "_" + id;

        let videos = this.mylistdata[key].mylistitem;
        for( let i = 0; i < items.length; i++ ){
            if( !items[i].selected ) continue;
            str += videos[i].item_data.video_id + " ";
        }
        debugprint( str );
        window.opener.NicoLiveStock.addStock( str );
    },

    // TODO マイリストに動画IDを直接指定して追加処理を呼び出す
    addVideo: function(){
        if( this.registerMylistQueue.length ) return;

        let video_id = window.prompt( "マイリストに追加する動画IDを入力してください", "" );
        if( !video_id ) return;

        this.registerMylistQueue = [];
        let d = video_id.match( /(sm|nm|so)\d+|\d{10}/g );

        for( let i = 0, item; item = d[i]; i++ ){
            this.registerMylistQueue.push( item );
        }
        MyListManager.max = this.registerMylistQueue.length;
        this.runAddingMyList();
    },

    copyToClipboard: function( type ){
        let items = $( '.mylist_item_selected' );
        let str = "";
        let id = $( '#mylist' ).val();
        let key = "_" + id;

        let videos = this.mylistdata[key].data.mylist.items;
        for( let i = 0; i < items.length; i++ ){
            let ind = items[i].rowIndex;
            switch( type ){
            case 0:
                // 動画ID
                str += videos[ind].video.id + "\n";
                break;
            case 1:
                // タイトル
                str += videos[ind].video.title + "\n";
                break;
            case 2:
                // 動画ID+タイトル
                str += videos[ind].video.id + "\t" + videos[ind].video.title + "\n";
                break;
            }
        }

        CopyToClipboard( str );
    },

    /**
     * ドラッグを開始する.
     * @param e
     */
    startItemDragging: function( e ){
        let dt = e.originalEvent.dataTransfer;

        dt.effectAllowed = 'move';

        // ドラッグ対象の動画IDを指定する
        let items = $( '.mylist_item_selected' );

        let key = $( '#mylist' ).val();
        let videos = this.mylistdata[`_${key}`].mylistitem;
        // console.log( checkbox );
        let str = "";
        let html = "";
        for( let i = 0, item; item = items[i]; i++ ){
            let ind = item.rowIndex;
            str += videos[ind].item_id + " ";
            //html += item.innerHTML;
        }
        dt.setData( 'text/plain', str );
        // dt.setData( 'text/html', html );

        if( !str ){
            // チェックがなければドラッグ開始しない
            e.preventDefault();
        }
    },

    getMyListPageToken: function( postfunc ){
        let f = function( xml, req ){
            if( req.readyState == 4 ){
                if( req.status == 200 ){
                    let token = req.responseText.match( /NicoAPI\.token\s*=\s*\"(.*)\";/ );
                    if( !token ){
                        token = req.responseText.match( /NicoAPI\.token\s*=\s*\'(.*)\';/ );
                    }

                    MyListManager.apitoken = token[1];
                    if( "function" == typeof postfunc ){
                        postfunc();
                    }
                    token = req.responseText.match( /nickname = \"(.*)\";/ );
                    debugprint( token[1] );
                    $( 'statusbar-username' ).label = token[1];
                }
            }
        };
        NicoApi.getUserMylistPageApiToken( f );
    },

    /**
     * マイリスト間で動画をコピーする.
     * @param from
     * @param to
     * @param ids
     */
    copy: function( from, to, ids ){
        let f = function( xml, req ){
            if( req.readyState == 4 ){
                if( req.status == 200 ){
                    let result = JSON.parse( req.responseText );
                    if( result.status == "fail" ){
                        SetStatusBarText( result.error.code + ": " + result.error.description );
                    }else{
                        SetStatusBarText( "コピーしました" );
                    }
                }
            }
        };

        if( from == 'default' ){
            NicoApi.copydeflist( to, ids, this.apitoken, f );
        }else{
            NicoApi.copymylist( from, to, ids, this.apitoken, f );
        }
    },

    /**
     * 移動処理後の画面更新をする
     * @param from
     * @param to
     * @param result
     */
    moveListItem: function( from, to, result ){
        // 2 件のうち 1 件はすでに移動先に存在しているため移動できませんでした
        try{
            let n1 = result.matches.item.length;
            let n2 = result.duplicates.item.length;
            SetStatusBarText( n1 + " 件のうち " + n2 + " 件はすでに移動先に存在しているため移動できませんでした" );
        }catch( x ){
            // 移動先に重複がない場合には result.duplicates.itemがないのでこっちに飛ぶ
            SetStatusBarText( result.targets.item.length + " 件を移動しました" );
        }

        let id = $( '#mylist' ).val();
        let key = "_" + id;
        let videos = this.mylistdata[key].mylistitem;
        let newarray = new Array();

        for( let i = 0; i < videos.length; i++ ){
            let b = false;
            for( let j = 0; j < result.targets.item.length; j++ ){
                let moved_id = result.targets.item[j].id;
                if( videos[i].item_id == moved_id ){
                    b = true;
                    break;
                }
            }
            if( b ) continue;
            newarray.push( videos[i] );
        }
        this.mylistdata[key].mylistitem = newarray;
        $( '#mylist-num' ).text( this.mylistdata[key].mylistitem.length + " 件" );

        let folder_listbox = $( '#folder-item-listbox' );
        folder_listbox.empty();

        for( let i = 0, item; item = this.mylistdata[key].mylistitem[i]; i++ ){
            let listitem = this.createListItemElement( item );
            folder_listbox.append( listitem );
        }
    },

    /**
     * マイリスト間で動画を移動する
     * @param from
     * @param to
     * @param ids
     */
    move: function( from, to, ids ){
        let f = function( xml, req ){
            if( req.readyState == 4 ){
                if( req.status == 200 ){
                    let result = JSON.parse( req.responseText );
                    if( result.status == "fail" ){
                        SetStatusBarText( result.error.code + ": " + result.error.description );
                    }else{
                        MyListManager.moveListItem( from, to, result );
                    }
                }
            }
        };
        if( from == 'default' ){
            NicoApi.movedeflist( to, ids, this.apitoken, f );
        }else{
            NicoApi.movemylist( from, to, ids, this.apitoken, f );
        }
    },

    /**
     * マイリスト一覧にドロップしたときの処理
     * @param e
     */
    dropItemToMyList: function( e ){
        e = e.originalEvent;
        let dt = e.dataTransfer;
        let effect = dt.dropEffect; // copy, move
        let target = e.target;
        let target_list_id = target.value;

        let source_list_id = $( '#mylist' ).val();

        let n = $( '#mylist' ).prop( 'selectedIndex' );
        let msg = $( '#mylist option' )[n].textContent + "," + source_list_id + "->" + target.label + "," + target.value;
        debugprint( msg );

        let tmp = dt.getData( "text/plain" );
        let ids = tmp.trim().split( /\s+/ );

        let f = function(){
            switch( effect ){
            case "move":
                MyListManager.move( source_list_id, target_list_id, ids );
                break;
            case "copy":
                MyListManager.copy( source_list_id, target_list_id, ids );
                break;
            }
        };

        if( !this.apitoken ){
            this.getMyListPageToken( f );
        }else{
            f();
        }
    },

    // 表示部分から削除する
    deleteFromListItem: function( ids ){
        let id = $( '#mylist' ).val();
        let key = "_" + id;
        let videos = this.mylistdata[key].mylistitem;

        let newarray = new Array();
        for( let i = 0; i < videos.length; i++ ){
            let b = false;
            for( let j = 0; j < ids.length; j++ ){
                if( videos[i].item_id == ids[j] ){
                    b = true;
                    break;
                }
            }
            if( b ) continue;
            newarray.push( videos[i] );
        }
        this.mylistdata[key].mylistitem = newarray;
        $( '#mylist-num' ).text( this.mylistdata[key].mylistitem.length + " 件" );

        let folder_listbox = $( '#folder-item-listbox' );
        folder_listbox.empty();

        for( let i = 0, item; item = this.mylistdata[key].mylistitem[i]; i++ ){
            let listitem = this.createListItemElement( item );
            folder_listbox.append( listitem );
        }

    },

    /**
     * チェックした動画を削除する.
     */
    delete: function(){
        if( !window.confirm( "選択した動画をマイリストから削除しますか?" ) ) return;

        let items = $( '.mylist_item_selected' );
        let id = $( '#mylist' ).val();
        let key = "_" + id;
        let str = "";

        // マイリストのアイテムIDをスペースで区切ったものをテキストとしてD&Dする
        let videos = this.mylistdata[key].mylistitem;
        for( let i = 0; i < items.length; i++ ){
            let ind = items[i].rowIndex;
            str += videos[ind].item_id + " ";
        }
        let ids = str.trim().split( /\s+/ );
        if( ids.length ){
            let f = function(){
                let f2 = function( xml, req ){
                    if( req.readyState == 4 ){
                        if( req.status == 200 ){
                            let result = JSON.parse( req.responseText );
                            if( result.status == "fail" ){
                                SetStatusBarText( result.error.code + ": " + result.error.description );
                            }else{
                                SetStatusBarText( "削除しました" );
                                MyListManager.deleteFromListItem( ids );
                            }
                        }
                    }
                };
                if( id == 'default' ){
                    NicoApi.deletedeflist( ids, MyListManager.apitoken, f2 );
                }else{
                    NicoApi.deletemylist( id, ids, MyListManager.apitoken, f2 );
                }
            };
            if( !this.apitoken ){
                this.getMyListPageToken( f );
            }else{
                f();
            }
        }
    },

    /**
     * 動画一覧表示にドロップしようとしているときの処理
     * @param event
     * @returns {boolean}
     */
    checkDropToListItem: function( event ){
        event.dataTransfer.effectAllowed = this.registerMylistQueue.length ? "none" : "all";

        let b = false;
        var file = event.dataTransfer.mozGetDataAt( "application/x-moz-file", 0 );
        if( file ){
            b = true;
        }
        if( event.dataTransfer.types.includes( 'text/plain' ) ) b = true;
        if( event.dataTransfer.types.includes( "text/uri-list" ) ) b = true;
        if( b ) event.preventDefault();
        return true;
    },

    finishAddingMyList: function(){
        this.registerMylistQueue = [];
        // TODO マイリス追加の終了表示
        // $( 'statusbar-progressmeter' ).mode = "determined";
        // $( 'statusbar-progressmeter' ).value = 0;
    },

    addMyListExec: function( item_id, mylist_id, token, video_id, additional_msg ){
        // 二段階目は取得したトークンを使ってマイリス登録をする.
        let f = function( xml, req ){
            if( req.readyState == 4 && req.status == 200 ){
                let result = JSON.parse( req.responseText );
                switch( result.status ){
                case 'ok':
                    // TODO マイリスト追加経過表示
                    let max = MyListManager.max;
                    let processed = max - MyListManager.registerMylistQueue.length;
                    SetStatusBarText( video_id + 'をマイリストしました。(' + processed + '/' + max + ')' );
                    setTimeout( function(){
                        MyListManager.runAddingMyList();
                    }, 1000 );
                    break;
                case 'fail':
                    if( result.error.code == 'EXIST' ){
                        setTimeout( function(){
                            MyListManager.runAddingMyList();
                        }, 1000 );
                    }else{
                        MyListManager.finishAddingMyList();
                    }
                    SetStatusBarText( result.error.description + ", " + video_id );
                    break;
                default:
                    break;
                }
            }
        };
        NicoApi.addMylist( item_id, mylist_id, token, additional_msg, f );
    },

    runAddingMyList: function(){
        if( this.registerMylistQueue.length == 0 ){
            this.finishAddingMyList();
            this.refreshCurrentMylist();
            return;
        }
        // TODO マイリス追加の経過表示プログレスバー
        // $( 'statusbar-progressmeter' ).value = $( 'statusbar-progressmeter' ).max - this.registerMylistQueue.length;

        let mylist_id = $( '#mylist' ).val();
        let video_id = this.registerMylistQueue.shift();
        if( mylist_id == 'default' ){
            this.finishAddingMyList();
            SetStatusBarText( "現在、あとで見るにはマイリスト登録できません。" );
            return;
        }

        // 一段階目はトークンを取得する.
        let f = function( xml, req ){
            if( req.readyState == 4 && req.status == 200 ){
                try{
                    let token = req.responseText.match( /NicoAPI\.token\s*=\s*\"(.*)\";/ );
                    if( !token ){
                        token = req.responseText.match( /NicoAPI\.token\s*=\s*\'(.*)\';/ );
                    }
                    let item_id = req.responseText.match( /item_id\"\s*value=\"(.*)\">/ );
                    debugprint( 'token=' + token[1] );
                    debugprint( 'item_id=' + item_id[1] );
                    MyListManager.addMyListExec( item_id[1], mylist_id, token[1], video_id, "" );
                }catch( x ){
                    MyListManager.finishAddingMyList();
                    SetStatusBarText( "マイリスト登録に失敗しました: " + video_id );
                }
            }
        };
        NicoApi.getMylistToken( video_id, f );
    },

    /**
     * マイリスト内容の表示ペインにドロップしたときの処理.
     * @param e
     */
    dropToRightPane: function( e ){
        if( this.registerMylistQueue.length ) return;

        e = e.originalEvent;

        if( e.dataTransfer.types.includes( "application/x-moz-file" ) ){
            // ファイルをドロップしたとき中身の動画IDをマイリストに追加する.
            let file = e.dataTransfer.files[0];
            if( file.name.match( /\.txt$/ ) ){
                let fileReader = new FileReader();
                fileReader.onload = ( ev ) => {
                    let txt = ev.target.result;
                    let video_ids = txt.match( /(sm|nm|so)\d+|\d{10}/g );
                    this.registerMylistQueue = [];
                    for( let i = 0, v; v = video_ids[i]; i++ ){
                        this.registerMylistQueue.push( v );
                    }
                    MyListManager.max = this.registerMylistQueue.length;
                    this.runAddingMyList();
                };
                fileReader.readAsText( file );
            }
            return;
        }

        let str = "";
        if( e.dataTransfer.types.includes( 'text/plain' ) ){
            str = e.dataTransfer.mozGetDataAt( "text/plain", 0 );
            debugprint( "drop text" );
        }
        // アンカーをドロップしたとき.
        if( e.dataTransfer.types.includes( "text/uri-list" ) ){
            str = e.dataTransfer.mozGetDataAt( "text/uri-list", 0 );
            str = str.match( /((sm|nm)\d+)/ )[1];
            debugprint( "uri dropped:" + str );
        }

        if( str ){
            this.registerMylistQueue = [];
            let d = str.match( /(sm|nm|so)\d+|\d{10}/g );
            for( let i = 0, item; item = d[i]; i++ ){
                this.registerMylistQueue.push( item );
            }
            MyListManager.max = this.registerMylistQueue.length;
            this.runAddingMyList();
        }
    },

    /**
     * マイリストをファイルに保存する
     */
    saveToFile: function(){
        let id = $( '#mylist' ).val();
        let key = "_" + id;
        let videos = this.mylistdata[key].data.mylist.items;

        let str = "";
        for( let i = 0; i < videos.length; i++ ){
            str += videos[i].video.id + "\t" + videos[i].video.title + "\r\n";
        }

        SaveText( 'mylist.txt', str );
    },

    /**
     * ストックに追加する
     */
    addToStock: function(){
        let items = $( '.mylist_item_selected' );
        let id = $( '#mylist' ).val();
        let key = "_" + id;
        let str = "";

        // マイリストのアイテムIDをスペースで区切ったものをテキストとしてD&Dする
        let videos = this.mylistdata[key].data.mylist.items;
        for( let i = 0; i < items.length; i++ ){
            let ind = items[i].rowIndex;
            str += videos[ind].video.id + " ";
        }
        window.opener.NicoLiveStock.addStocks( str );
    },

    /**
     * 現在のマイリストの表示を更新する.
     */
    refreshCurrentMylist: function(){
        let mylist_id = $( '#mylist' ).val();
        let name = $( '#mylist option:selected' ).text();
        this.loadMyList( mylist_id, name );
    },


    /**
     * CTRL+AとDELキーを処理する.
     * @param event
     * @returns {boolean}
     */
    onkeydown: function( event ){
        //debugprint(event);
        //this._data = event;
        switch( event.keyCode ){
        case 65: // A
            if( event.ctrlKey || event.metaKey ){
                $( 'folder-item-listbox' ).selectAll();
                event.stopPropagation();
                return false;
            }
            break;
        case 46: // DEL
            this.delete();
            break;
        }
        return true;
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

    init: function(){
        this.getMylistGroup();
        // this.getMyListPageToken();

        $( document ).on( 'click', '#folder-item-listbox tr', ( ev ) => {
            console.log( ev );
            let tr = FindParentElement( ev.target, 'tr' );
            console.log( tr );

            if( ev.originalEvent.metaKey || ev.originalEvent.ctrlKey ){
                if( $( tr ).hasClass( 'mylist_item_selected' ) ){
                    $( tr ).removeClass( 'mylist_item_selected' );
                }else{
                    $( tr ).addClass( 'mylist_item_selected' );
                    this._index = tr.rowIndex;
                }
            }else if( ev.originalEvent.shiftKey ){
                let rows = $( '#folder-item-listbox tr' );
                let start = Math.min( this._index, tr.rowIndex );
                let end = Math.max( this._index, tr.rowIndex );
                for( let i = start; i <= end; i++ ){
                    $( rows[i] ).addClass( 'mylist_item_selected' );
                }
            }else{
                $( '#folder-item-listbox tr' ).removeClass( 'mylist_item_selected' );
                $( tr ).addClass( 'mylist_item_selected' );
                this._index = tr.rowIndex;
            }

            SetStatusBarText( `選択: ${$( '.mylist_item_selected' ).length}` );
        } );


        let mylist = $( '#mylist' );
        // 選択したマイリストを読み込む
        mylist.on( 'change', ( ev ) => {
            let mylist_id = ev.target.value;
            let name = $( '#mylist option:selected' ).text();
            this.loadMyList( mylist_id, name );
        } );

        $( '#select-sort-order' ).on( 'change', ( ev ) => {
            this.doSort( ev.target.value );
        } );

        $( '#folder-item-listbox' ).on( 'dragstart', ( ev ) => {
            this.startItemDragging( ev );
        } );

        mylist.on( 'dragenter', ( ev ) => {
            $( ev.target ).addClass( 'dragover' );
        } );
        mylist.on( 'dragover', ( ev ) => {
            ev.preventDefault();
        } );
        mylist.on( 'dragleave', ( ev ) => {
            $( ev.target ).removeClass( 'dragover' );
        } );
        mylist.on( 'drop', ( ev ) => {
            ev.preventDefault();
            $( ev.target ).removeClass( 'dragover' );
            this.dropItemToMyList( ev );
        } );

        let videolist = $( '#videolist' );
        $( '#folder-item-listbox' ).on( 'dragover', ( ev ) => {
            videolist.addClass( 'dragover' );
            ev.preventDefault();
        } );

        videolist.on( 'dragover', ( ev ) => {
            ev.originalEvent.dataTransfer.effectAllowed = this.registerMylistQueue.length ? "none" : "all";
            ev.preventDefault();
        } );
        videolist.on( 'dragenter', ( ev ) => {
            videolist.addClass( 'dragover' );
            ev.originalEvent.dataTransfer.effectAllowed = this.registerMylistQueue.length ? "none" : "all";
        } );
        videolist.on( 'dragleave', ( ev ) => {
            videolist.removeClass( 'dragover' );
        } );
        videolist.on( 'drop', ( ev ) => {
            ev.preventDefault();
            videolist.removeClass( 'dragover' );
            this.dropToRightPane( ev );
        } );

        $.contextMenu( {
            selector: '.nico-video-row',
            build: function( $triggerElement, e ){
                let menuobj = {
                    zIndex: 10,
                    callback: function( key, options ){
                        MyListManager.contextMenu( key, options );
                    },
                    items: {
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
                        "save": {name: 'マイリストをファイルに保存'}
                    }
                };
                return menuobj;
            },
        } );

    },
    destroy: function(){
    }
};


window.addEventListener( "load", function( e ){
    MyListManager.init();
}, false );
window.addEventListener( "unload", function( e ){
    MyListManager.destroy();
}, false );


let NicoLiveHelper = {};
browser.management.getSelf().then( ( info ) => {
    NicoLiveHelper.version = info.version;
} );
