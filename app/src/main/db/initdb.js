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


var DB = {
    db: null,

    initDB: function(){
        let db = new Dexie( "NicoVideoDatabase" );
        db.version( 1 ).stores( {
            videodb: "&video_id,user_id,user_nickname,title,description,first_retrieve,length,view_counter,comment_num,mylist_counter,*tags_array,highbitrate,lowbitrate,movie_type,no_live_play"
        } );

        this.db = db;
        return db;
    },

    put: function( vinfo ){
        console.log( `動画DBに ${vinfo.video_id} を追加更新しました` );
        this.db.videodb.put( vinfo );
    },

    delete: function( video_id ){
        console.log( `動画DBから ${video_id} を削除しました` );
        this.db.videodb.bulkDelete( [video_id] );
    },

    /**
     * 動画DBの保存した検索条件からランダムで1つ動画を選ぶ.
     * @param name
     * @returns {Promise<VideoInformation>}
     */
    choice: async function( name ){
        let result = await browser.storage.local.get( 'saved-search' );
        let saved = result['saved-search'] || {};

        let conditions = saved[name];
        console.log( conditions );
        if( !conditions ) return null;

        let n = conditions.length;
        let filter_func = [];
        for( let i = 0; i < n; i++ ){
            let t = conditions[i].type;
            let c = conditions[i].cond;
            let v = conditions[i].value;
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
        result = await this.db.videodb.filter( ( item ) =>{
            for( let f of filter_func ){
                let flg = f( item );
                if( !flg ) return false;
            }
            return true;
        } ).toArray();

        ShuffleArray( result );
        return result[0];
    }
};
