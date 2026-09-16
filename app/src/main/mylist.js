/*
 Copyright (c) 2017 amano <amano@miku39.jp>

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

var NicoLiveMylist = {
    mylists: [],            // マイリストグループ
    series: [],             // シリーズ一覧
    mylist_itemdata: {},    // 動画のマイリスト登録日とマイリストコメント

    /**
     * 指定のシリーズ内の動画IDリストを取得.
     * @param series_id
     * @returns {Promise<Array>}
     */
    retrieveVideoIdFromSeries: async function( series_id ){
        let p = new Promise( ( resolve, reject ) => {
            let f = ( xml, req ) => {
                if( req.readyState == 4 ){
                    if( req.status == 200 ){
                        try{
                            let res = JSON.parse( req.responseText );
                            let items = (res.data && res.data.items) || [];
                            let videos = [];
                            for( let item of items ){
                                let video_id = (item.video && item.video.id) || item.id;
                                if( video_id ){
                                    videos.push( video_id );
                                }
                            }
                            resolve( videos );
                        }catch( x ){
                            console.error( x );
                            resolve( [] );
                        }
                    }else{
                        resolve( [] );
                    }
                }
            };
            NicoApi.getSeries( series_id, f );
        } );
        return p;
    },

    /**
     * 指定のマイリスト内の動画IDリストを取得 (nvapi経由).
     * マイリストコメントも拾って保存する。
     * @param mylist_id
     * @returns {Promise<Array>}
     */
    retrieveVideoIdFromMylist: async function( mylist_id ){
        let parseMylistItems = ( items ) => {
            let videos = [];
            for( let item of items ){
                let video_id = (item.video && item.video.id) || item.watchId;
                if( video_id ){
                    videos.push( video_id );
                    let pubDate = item.addedAt ? (new Date( item.addedAt )).getTime() / 1000 : 0;
                    let dat = {
                        "pubDate": pubDate,
                        "description": item.description || ""
                    };
                    this.mylist_itemdata["_" + video_id] = dat;
                    this.mylist_itemdata[video_id] = dat;
                }
            }
            return videos;
        };

        let fetchWithApi = ( apiFunc ) => {
            return new Promise( ( resolve ) => {
                apiFunc( mylist_id, ( xml, req ) => {
                    if( req && req.readyState == 4 && req.status == 200 ){
                        try{
                            let res = JSON.parse( req.responseText );
                            if( res && res.data && res.data.mylist && Array.isArray( res.data.mylist.items ) ){
                                resolve( parseMylistItems( res.data.mylist.items ) );
                                return;
                            }
                        }catch( e ){
                            console.error( 'Failed to parse mylist response:', e );
                        }
                    }
                    resolve( null );
                } );
            } );
        };

        // 1. まずログイン中の自身のマイリスト(非公開含む)を試行
        let videos = await fetchWithApi( NicoApi.getMylist.bind( NicoApi ) );
        if( videos !== null ){
            return videos;
        }

        // 2. 失敗した場合(他人の公開マイリストなど)、公開マイリストAPI (v2) を試行
        videos = await fetchWithApi( NicoApi.getPublicMylist.bind( NicoApi ) );
        if( videos !== null ){
            return videos;
        }

        return [];
    },

    /**
     * 後方互換性のためのエイリアス
     */
    retrieveVideoIdFromRSS: async function( mylist_id ){
        return this.retrieveVideoIdFromMylist( mylist_id );
    },

    getName: function( mylist_id ){
        for( let i = 0, item; item = this.mylists.mylistgroup[i]; i++ ){
            if( item.id == mylist_id ){
                return item.name;
            }
        }
        return undefined;
    },

    /**
     * とりマイに登録する（非推奨/仕様変更済み）
     */
    addDeflist: function( video_id, additional_msg ){
        NicoLiveHelper.showAlert( 'ニコニコの仕様変更により、本アプリからのマイリスト直接追加は現在サポートされていません。' );
    },

    /**
     * マイリストに追加する（非推奨/仕様変更済み）
     */
    addMylist: function( mylist_id, video_id, additional_msg ){
        NicoLiveHelper.showAlert( 'ニコニコの仕様変更により、本アプリからのマイリスト直接追加は現在サポートされていません。' );
    },

    processMylistGroup: function(){
        // ストックのマイリストメニューに項目を追加
        let menu = $( '#menu-stock-mylist' );
        menu.empty();

        let aDef = document.createElement( 'a' );
        aDef.setAttribute( 'class', 'dropdown-item' );
        aDef.setAttribute( 'href', '#' );
        aDef.setAttribute( 'nico_grp_id', 'deflist' );
        aDef.appendChild( document.createTextNode( 'あとで見る' ) );
        menu.append( aDef );
        menu.append( '<div class="dropdown-divider"></div>' );

        // マイリスト一覧
        if( NicoLiveMylist.mylists && NicoLiveMylist.mylists.data && NicoLiveMylist.mylists.data.mylists ){
            let header = document.createElement( 'h6' );
            header.setAttribute( 'class', 'dropdown-header' );
            header.appendChild( document.createTextNode( 'マイリスト' ) );
            menu.append( header );

            for( let i = 0, grp; grp = NicoLiveMylist.mylists.data.mylists[i]; i++ ){
                let a = document.createElement( 'a' );
                a.setAttribute( 'class', 'dropdown-item' );
                a.setAttribute( 'href', '#' );
                a.setAttribute( 'nico_grp_id', grp.id );
                a.appendChild( document.createTextNode( grp.name ) );
                menu.append( a );
            }
        }

        // シリーズ一覧
        if( NicoLiveMylist.series && NicoLiveMylist.series.length > 0 ){
            menu.append( '<div class="dropdown-divider"></div>' );
            let header = document.createElement( 'h6' );
            header.setAttribute( 'class', 'dropdown-header' );
            header.appendChild( document.createTextNode( 'シリーズ' ) );
            menu.append( header );

            for( let i = 0, s; s = NicoLiveMylist.series[i]; i++ ){
                let a = document.createElement( 'a' );
                a.setAttribute( 'class', 'dropdown-item' );
                a.setAttribute( 'href', '#' );
                a.setAttribute( 'nico_series_id', s.id );
                let countStr = s.itemsCount != null ? ` (${s.itemsCount})` : '';
                a.appendChild( document.createTextNode( s.title + countStr ) );
                menu.append( a );
            }
        }
    },

    loadSeries: function(){
        let f = function( xml, req ){
            if( req.readyState == 4 && req.status == 200 ){
                try{
                    let res = JSON.parse( req.responseText );
                    if( res && res.data && Array.isArray( res.data.items ) ){
                        NicoLiveMylist.series = res.data.items;
                        NicoLiveMylist.processMylistGroup();
                    }
                }catch( x ){
                    console.error( 'Failed to load series:', x );
                }
            }
        };
        NicoApi.getMySeries( f );
    },

    /**
     * マイリストグループを取得してドロップダウンメニューに追加する
     */
    loadMylist: function(){
        this.loadSeries();
        let f = function( xml, req ){
            if( req.readyState == 4 && req.status == 200 ){
                try{
                    NicoLiveMylist.mylists = JSON.parse( req.responseText );
                    NicoLiveMylist.processMylistGroup();
                }catch( x ){
                    if( NicoLiveMylist.mylists && NicoLiveMylist.mylists.status == 'fail' ){
                        NicoLiveHelper.showAlert( NicoLiveMylist.mylists.error.description );
                    }
                    return;
                }

                if( NicoLiveMylist.mylists && NicoLiveMylist.mylists.status == 'fail' ){
                    NicoLiveHelper.showAlert( NicoLiveMylist.mylists.error.description );
                    return;
                }
            }
        };
        NicoApi.getmylistgroup( f );
    },

    init: function(){
        this.loadMylist();
    },

    destroy: function(){

    }
};


window.addEventListener( "unload", ( ev ) =>{
    NicoLiveMylist.destroy();
} );

