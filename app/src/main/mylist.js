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
     * 指定のマイリスト内の動画IDリストを取得.
     * マイリストコメントも拾って保存する。
     * @param mylist_id
     * @returns {Promise<any>}
     */
    retrieveVideoIdFromRSS: async function( mylist_id ){
        let p = new Promise( ( resolve, reject ) =>{
            let f = ( xml, req ) =>{
                if( req.readyState == 4 ){
                    if( req.status == 200 ){
                        let xml = req.responseXML;
                        let items = xml.getElementsByTagName( 'item' );
                        let videos = [];
                        console.log( 'mylist rss items:' + items.length );
                        for( let i = 0, item; item = items[i]; i++ ){
                            let video_id;
                            let description;
                            try{
                                video_id = item.getElementsByTagName( 'link' )[0].textContent.match( /(sm|nm)\d+|\d{10}/ );
                            }catch( x ){
                                video_id = "";
                            }
                            if( video_id ){
                                videos.push( video_id[0] );
                                try{
                                    description = item.getElementsByTagName( 'description' )[0].textContent;
                                    description = description.replace( /[\r\n]/mg, '<br>' );
                                    description = description.match( /<p class="nico-memo">(.*?)<\/p>/ )[1];
                                }catch( x ){
                                    description = "";
                                }

                                let d = new Date( item.getElementsByTagName( 'pubDate' )[0].textContent );
                                let dat = {
                                    "pubDate": d.getTime() / 1000,  // 登録日 UNIX time
                                    "description": description
                                };
                                this.mylist_itemdata[video_id[0]] = dat;
                            }
                        }// end for.
                        resolve( videos );
                    }else{
                        resolve( [] );
                    }
                }
            };
            NicoApi.mylistRSS( mylist_id, f );
        } );
        return p;
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
     * とりマイに追加する(本処理)
     * @param video_id 動画ID
     * @param item_id
     * @param token
     * @param additional_msg マイリストコメント
     */
    addDeflistExec: function( video_id, item_id, token, additional_msg ){
        // 二段階目は取得したトークンを使ってマイリス登録をする.
        let f = function( xml, xmlhttp ){
            if( xmlhttp.readyState == 4 && xmlhttp.status == 200 ){
                let result = JSON.parse( xmlhttp.responseText );
                switch( result.status ){
                case 'ok':
                    NicoLiveHelper.showAlert( `${video_id}を"あとで見る"しました` );
                    break;
                case 'fail':
                    NicoLiveHelper.showAlert( result.error.description );
                    break;
                default:
                    break;
                }
            }
        };
        NicoApi.addDeflist( item_id, token, additional_msg, f );
    },

    /**
     * とりマイに登録する.
     * @param video_id 動画ID
     * @param additional_msg マイリストコメント
     */
    addDeflist: function( video_id, additional_msg ){
        // 一段階目はトークンを取得する.
        if( !video_id ) return;
        let f = function( xml, xmlhttp ){
            if( xmlhttp.readyState == 4 && xmlhttp.status == 200 ){
                try{
                    let token = xmlhttp.responseText.match( /NicoAPI\.token\s*=\s*\"(.*)\";/ );
                    if( !token ){
                        token = xmlhttp.responseText.match( /NicoAPI\.token\s*=\s*\'(.*)\';/ );
                    }
                    let item_id = xmlhttp.responseText.match( /item_id\"\s*value=\"(.*)\">/ );
                    token = token[1];
                    item_id = item_id[1];
                    NicoLiveMylist.addDeflistExec( video_id, item_id, token, additional_msg );
                }catch( x ){
                    console.log( x );
                    NicoLiveHelper.showAlert( 'あとで見るに追加に失敗しました' );
                }
            }
        };
        NicoApi.getMylistToken( video_id, f );
    },

    /**
     * マイリストに登録する(本処理)
     * @param item_id
     * @param mylist_id マイリストID
     * @param token
     * @param video_id 動画ID
     * @param additional_msg マイリストコメント
     */
    addMyListExec: function( item_id, mylist_id, token, video_id, additional_msg ){
        // 二段階目は取得したトークンを使ってマイリス登録をする.
        let f = function( xml, req ){
            if( req.readyState == 4 && req.status == 200 ){
                let result = JSON.parse( req.responseText );
                switch( result.status ){
                case 'ok':
                    NicoLiveHelper.showAlert( `${video_id}を「${NicoLiveMylist.getName( mylist_id )}」にマイリストしました` );
                    break;
                case 'fail':
                    NicoLiveHelper.showAlert( result.error.description );
                    break;
                default:
                    break;
                }
            }
        };
        NicoApi.addMylist( item_id, mylist_id, token, additional_msg, f );
    },

    /**
     * マイリストに追加する.
     * @param mylist_id マイリストID
     * @param video_id 動画ID
     * @param additional_msg 追加メッセージ
     */
    addMylist: function( mylist_id, video_id, additional_msg ){
        console.log( `Add mylist: ${mylist_id}, ${video_id}` );

        if( mylist_id == 'default' ){
            this.addDeflist( video_id, additional_msg );
        }else{
            // 一段階目はトークンを取得する.
            let f = function( xml, req ){
                if( req.readyState == 4 && req.status == 200 ){
                    try{
                        let token = req.responseText.match( /NicoAPI\.token\s*=\s*\"(.*)\";/ );
                        if( !token ){
                            token = req.responseText.match( /NicoAPI\.token\s*=\s*\'(.*)\';/ );
                        }
                        let item_id = req.responseText.match( /item_id\"\s*value=\"(.*)\">/ );
                        NicoLiveMylist.addMyListExec( item_id[1], mylist_id, token[1], video_id, additional_msg );
                    }catch( x ){
                        console.log( x );
                        NicoLiveHelper.showAlert( 'マイリスト追加に失敗しました' );
                    }
                }
            };
            NicoApi.getMylistToken( video_id, f );
        }
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

