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

var NicoApi = {
    // niconico.comで生放送するときにアクセスする先のドメイン
    live_base_uri_en: "https://watch.live.niconico.com/api/",
    live_base_uri_jp: "https://watch.live.nicovideo.jp/api/",
    live_base_uri: "",
    base_uri_jp: "https://www.nicovideo.jp/",
    base_uri_en: "https://video.niconico.com/",
    base_uri: "",

    nicoapi_header: {
        "X-Frontend-Id": 6,
        "X-Frontend-Version": 0,
        "X-Niconico-Language": "ja-jp"
    },

    callApi: function( url, postfunc, postdata, extra_header ){
        let req;
        if( postdata ){
            req = CreateXHR( "POST", url );
        }else{
            req = CreateXHR( "GET", url );
        }
        if( !req ){
            postfunc( null );
            return;
        }
        if( extra_header ){
            for( let key in extra_header ){
                req.setRequestHeader( key, extra_header[key] );
            }
        }

        req.onreadystatechange = function(){
            if( req.readyState != 4 ) return;
            if( req.status != 200 ){
                console.log( url + " failed." + req.status );
                postfunc( null, req );
                return;
            }
            postfunc( req.responseXML, req );
        };
        if( postdata ){
            req.setRequestHeader( 'Content-type', 'application/x-www-form-urlencoded; charset=UTF-8' );
            req.send( postdata.join( "&" ) );
        }else{
            req.send( "" );
        }
    },

    getthumbinfo: function( video_id, postfunc ){
        let url = "https://ext.nicovideo.jp/api/getthumbinfo/" + video_id;
        this.callApi( url, postfunc );
    },

    mylistRSS: function( mylist_id, postfunc ){
        let url = `https://www.nicovideo.jp/mylist/${mylist_id}?rss=2.0&lang=ja-jp&special_chars_decode=1
`;
        this.callApi( url, postfunc );
    },

    /**
     * 自身のマイリストの内容を取得する
     * @param mylist_id
     * @param postfunc
     */
    getMylist: function( mylist_id, postfunc ){
        let url = `https://nvapi.nicovideo.jp/v1/users/me/mylists/${mylist_id}?pageSize=500&page=1`
        this.callApi( url, postfunc, null, this.nicoapi_header );
    },


    /**
     * あとで見る（とりあえずマイリスト）に登録してある動画一覧を得る.
     */
    getDeflist: function( postfunc ){
        let url = "https://nvapi.nicovideo.jp/v1/users/me/watch-later?sortKey=addedAt&sortOrder=desc&pageSize=500&page=1";
        this.callApi( url, postfunc, null, this.nicoapi_header );
    },
    /**
     * マイリストの一覧を得る.
     */
    getmylistgroup: function( postfunc ){
        /*
        X-Frontend-Id: 6
        X-Frontend-Version: 0
        X-Niconico-Language: ja-jp
         */
        let url = "https://nvapi.nicovideo.jp/v1/users/me/mylists?sampleItemCount=3";
        this.callApi( url, postfunc, null, this.nicoapi_header );
    },
    /**
     * マイリストに登録してある動画一覧を得る.
     */
    getmylist: function( item_id, postfunc ){
        let url = `https://nvapi.nicovideo.jp/v1/users/me/mylists/${item_id}?pageSize=500&page=1`;
        this.callApi( url, postfunc, null, this.nicoapi_header );
    },


    /**
     * ログイン中のユーザー情報を取得する
     * @param postfunc
     */
    getMyInfo: function( postfunc ){
        let url = "https://nvapi.nicovideo.jp/v1/users/me";
        this.callApi( url, postfunc, null, this.nicoapi_header );
    },

    /**
     * 指定ユーザーのシリーズ一覧を取得する
     * @param user_id
     * @param postfunc
     */
    getUserSeries: function( user_id, postfunc ){
        let url = `https://nvapi.nicovideo.jp/v1/users/${user_id}/series?pageSize=100`;
        this.callApi( url, postfunc, null, this.nicoapi_header );
    },

    /**
     * 自身のシリーズ一覧を取得する
     * @param postfunc
     */
    getMySeries: function( postfunc ){
        let self = this;
        // まずusers/meでuserIdを取得
        this.getMyInfo( function( xml, req ){
            if( req && req.status == 200 ){
                try{
                    let res = JSON.parse( req.responseText );
                    let userId = (res.data && (res.data.id || res.data.userId));
                    if( userId ){
                        self.getUserSeries( userId, postfunc );
                        return;
                    }
                }catch( e ){
                    console.error( e );
                }
            }
            // フォールバック: 直接users/me/seriesを試行
            let fallbackUrl = "https://nvapi.nicovideo.jp/v1/users/me/series?pageSize=100";
            self.callApi( fallbackUrl, postfunc, null, self.nicoapi_header );
        } );
    },

    /**
     * シリーズに含まれる動画一覧を取得する
     * @param series_id
     * @param postfunc
     */
    getSeries: function( series_id, postfunc ){
        let url = `https://nvapi.nicovideo.jp/v2/series/${series_id}?pageSize=500`;
        this.callApi( url, postfunc, null, this.nicoapi_header );
    },

    /**
     * スナップショット検索API v2によるタグ検索
     * @param {string} tag 検索タグ
     * @param {object} options オプション (targets, sort, limit, context)
     * @param {function} postfunc コールバック関数 (xml, req)
     */
    snapshotSearch: function( tag, options, postfunc ){
        options = options || {};
        let targets = options.targets || 'tagsExact';
        let sort = options.sort || '-startTime';
        let limit = Math.min( Math.max( parseInt( options.limit ) || 10, 1 ), 100 );
        let context = options.context || 'NicoLiveHelperX';
        let fields = options.fields || 'contentId,title,description,tags,categoryTags,viewCounter,mylistCounter,commentCounter,startTime,thumbnailUrl,lengthSeconds,userId';

        let params = [
            'q=' + encodeURIComponent( tag ),
            'targets=' + encodeURIComponent( targets ),
            'fields=' + encodeURIComponent( fields ),
            '_sort=' + encodeURIComponent( sort ),
            '_limit=' + limit,
            '_context=' + encodeURIComponent( context )
        ];

        let url = 'https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?' + params.join( '&' );
        this.callApi( url, postfunc );
    }
};

NicoApi.base_uri = NicoApi.base_uri_jp;
NicoApi.live_base_uri = NicoApi.live_base_uri_jp;
